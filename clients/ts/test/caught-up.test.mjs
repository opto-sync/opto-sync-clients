import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CaughtUpBarrierError,
  awaitCaughtUp,
  checkpointReached,
  requestAndAwaitCaughtUp,
} from '../dist/caught-up.js';

class CheckpointQueue {
  constructor(checkpoint = '0') {
    this.checkpoint = checkpoint;
  }

  async pullCheckpoint() {
    return this.checkpoint;
  }
}

function cycleResult(checkpoint) {
  return {
    pushedMutations: 0,
    acknowledgedMutations: 0,
    pulledChanges: 0,
    installedSnapshots: 0,
    checkpoint,
    hasMorePending: false,
  };
}

test('checkpointReached compares canonical decimal checkpoints numerically', () => {
  assert.equal(checkpointReached('9', '10'), false);
  assert.equal(checkpointReached('10', '10'), true);
  assert.equal(checkpointReached('100000000000000000000', '99'), true);
  assert.throws(
    () => checkpointReached('01', '1'),
    (error) =>
      error instanceof CaughtUpBarrierError &&
      error.code === 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT',
  );
});

test('already-caught-up reads durable state without starting network work', async () => {
  const queue = new CheckpointQueue('8');
  let cycles = 0;
  const loop = {
    state: { status: 'idle' },
    async syncNow() {
      cycles += 1;
      return cycleResult(queue.checkpoint);
    },
  };

  const result = await awaitCaughtUp(
    loop,
    queue,
    { protocolVersion: 1, checkpoint: '7' },
    { timeoutMs: 100 },
  );

  assert.equal(cycles, 0);
  assert.equal(result.alreadyCaughtUp, true);
  assert.equal(result.checkpoint, '8');
  assert.equal(result.cycles, 0);
});

test('caught-up completion is based on the durable checkpoint, not cycle result', async () => {
  const queue = new CheckpointQueue('0');
  let cycles = 0;
  const loop = {
    state: { status: 'idle' },
    async syncNow() {
      cycles += 1;
      // First cycle *claims* checkpoint 5 but only persists 3. The barrier must
      // continue. The second cycle persists 5 and may then satisfy the target.
      if (cycles === 1) {
        queue.checkpoint = '3';
        return cycleResult('5');
      }
      queue.checkpoint = '5';
      return cycleResult('5');
    },
  };

  const result = await awaitCaughtUp(
    loop,
    queue,
    { protocolVersion: 1, checkpoint: '5' },
    { timeoutMs: 500, pollIntervalMs: 0 },
  );

  assert.equal(cycles, 2);
  assert.equal(result.checkpoint, '5');
  assert.equal(result.cycles, 2);
  assert.equal(result.alreadyCaughtUp, false);
});

test('caller cancellation does not abort the shared sync cycle', async () => {
  const queue = new CheckpointQueue('0');
  let release;
  let markStarted;
  let completed = false;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const sharedCycle = new Promise((resolve) => {
    release = () => {
      queue.checkpoint = '9';
      completed = true;
      resolve(cycleResult('9'));
    };
  });
  const loop = {
    state: { status: 'idle' },
    syncNow() {
      markStarted();
      return sharedCycle;
    },
  };
  const controller = new AbortController();
  const waiting = awaitCaughtUp(
    loop,
    queue,
    { protocolVersion: 1, checkpoint: '9' },
    { timeoutMs: 500, signal: controller.signal },
  );

  await started;
  controller.abort();
  await assert.rejects(
    waiting,
    (error) =>
      error instanceof CaughtUpBarrierError &&
      error.code === 'CAUGHT_UP_CANCELLED',
  );
  assert.equal(completed, false);

  // The underlying cycle remains alive; cancelling this caller did not abort it.
  release();
  await sharedCycle;
  assert.equal(completed, true);
  assert.equal(queue.checkpoint, '9');
});

test('offline is a typed terminal result for the caller', async () => {
  const queue = new CheckpointQueue('1');
  const loop = {
    state: { status: 'offline' },
    async syncNow() {
      throw new Error('must not sync while offline');
    },
  };

  await assert.rejects(
    awaitCaughtUp(
      loop,
      queue,
      { protocolVersion: 1, checkpoint: '2' },
      { timeoutMs: 100, isOnline: () => false },
    ),
    (error) =>
      error instanceof CaughtUpBarrierError &&
      error.code === 'CAUGHT_UP_OFFLINE',
  );
});

test('no checkpoint progress remains bounded by timeout', async () => {
  const queue = new CheckpointQueue('4');
  let cycles = 0;
  const loop = {
    state: { status: 'idle' },
    async syncNow() {
      cycles += 1;
      return cycleResult('4');
    },
  };

  await assert.rejects(
    awaitCaughtUp(
      loop,
      queue,
      { protocolVersion: 1, checkpoint: '5' },
      { timeoutMs: 25, pollIntervalMs: 2 },
    ),
    (error) =>
      error instanceof CaughtUpBarrierError &&
      error.code === 'CAUGHT_UP_TIMEOUT' &&
      error.localCheckpoint === '4',
  );
  assert.ok(cycles >= 1);
});

test('generation mismatch fails closed before synchronization', async () => {
  const queue = new CheckpointQueue('0');
  let cycles = 0;
  const loop = {
    state: { status: 'idle' },
    async syncNow() {
      cycles += 1;
      return cycleResult('0');
    },
  };

  await assert.rejects(
    awaitCaughtUp(
      loop,
      queue,
      { protocolVersion: 1, checkpoint: '10', generation: 'scope-b' },
      { expectedGeneration: 'scope-a', timeoutMs: 100 },
    ),
    (error) =>
      error instanceof CaughtUpBarrierError &&
      error.code === 'CAUGHT_UP_INVALIDATED',
  );
  assert.equal(cycles, 0);
});

test('requestAndAwaitCaughtUp requests source-now then drives to durable target', async () => {
  const queue = new CheckpointQueue('2');
  const events = [];
  const requester = {
    async requestCheckpoint(signal) {
      assert.equal(signal.aborted, false);
      events.push('request-target');
      return { protocolVersion: 1, checkpoint: '4', generation: 'g1' };
    },
  };
  const loop = {
    state: { status: 'idle' },
    async syncNow() {
      events.push(`sync-from-${queue.checkpoint}`);
      queue.checkpoint = queue.checkpoint === '2' ? '3' : '4';
      return cycleResult(queue.checkpoint);
    },
  };

  const result = await requestAndAwaitCaughtUp(loop, queue, requester, {
    expectedGeneration: 'g1',
    timeoutMs: 500,
    pollIntervalMs: 0,
  });

  assert.deepEqual(events, ['request-target', 'sync-from-2', 'sync-from-3']);
  assert.equal(result.targetCheckpoint, '4');
  assert.equal(result.checkpoint, '4');
});
