import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProtocolSyncLoop,
  SyncTransportError,
  computeRetryDelay,
} from '../dist/sync-loop.js';

function mutation(id = '1') {
  return {
    mutationId: id,
    operation: 'upsert',
    table: 'docs',
    recordId: `record-${id}`,
    payload: { id },
  };
}

function change(checkpoint, id) {
  return {
    checkpoint,
    table: 'docs',
    recordId: id,
    operation: 'upsert',
    record: { id },
    revision: checkpoint,
  };
}

class FakeQueue {
  constructor(events, pending = []) {
    this.events = events;
    this.pending = [...pending];
    this.checkpoint = '0';
  }

  async protocolPushRequest(limit = 100) {
    return {
      protocolVersion: 1,
      clientId: 'device-a',
      mutations: this.pending.slice(0, limit),
    };
  }

  async acknowledgePush(response, request) {
    assert.equal(
      response.lastMutationId,
      request.mutations.at(-1).mutationId,
    );
    const watermark = BigInt(response.lastMutationId);
    const before = this.pending.length;
    this.pending = this.pending.filter(
      (entry) => BigInt(entry.mutationId) > watermark,
    );
    this.events.push(`ack:${response.lastMutationId}`);
    return before - this.pending.length;
  }

  async pullCheckpoint() {
    return this.checkpoint;
  }

  async setPullCheckpoint(checkpoint) {
    this.checkpoint = checkpoint;
    this.events.push(`checkpoint:${checkpoint}`);
  }

  async installSnapshot(snapshot, replaceAuthoritative) {
    await replaceAuthoritative(snapshot.records);
    this.checkpoint = snapshot.checkpoint;
    this.events.push(`checkpoint:${snapshot.checkpoint}`);
  }
}

test('one cycle pulls, uploads an immutable batch, then pulls its echo', async () => {
  const events = [];
  const queue = new FakeQueue(events, [mutation()]);
  let pull = 0;
  const transport = {
    async pull(checkpoint) {
      pull += 1;
      if (pull === 1) {
        assert.equal(checkpoint, '0');
        return {
          protocolVersion: 1,
          checkpoint: '1',
          hasMore: false,
          changes: [change('1', 'remote-before-push')],
        };
      }
      assert.equal(checkpoint, '1');
      return {
        protocolVersion: 1,
        checkpoint: '2',
        hasMore: false,
        changes: [change('2', 'record-1')],
      };
    },
    async push(request) {
      events.push(`push:${request.mutations.map((entry) => entry.mutationId)}`);
      return {
        protocolVersion: 1,
        clientId: request.clientId,
        lastMutationId: '1',
        checkpoint: '2',
        results: [{ mutationId: '1', status: 'applied' }],
      };
    },
    async snapshot() {
      throw new Error('snapshot was not expected');
    },
  };
  const loop = new ProtocolSyncLoop(queue, transport, {
    async applyChanges(changes) {
      events.push(`apply:${changes.map((entry) => entry.checkpoint)}`);
    },
    async replaceAuthoritative() {
      throw new Error('replacement was not expected');
    },
  });

  const result = await loop.syncNow();
  assert.deepEqual(events, [
    'apply:1',
    'checkpoint:1',
    'push:1',
    'ack:1',
    'apply:2',
    'checkpoint:2',
  ]);
  assert.deepEqual(result, {
    pushedMutations: 1,
    acknowledgedMutations: 1,
    pulledChanges: 2,
    installedSnapshots: 0,
    checkpoint: '2',
    hasMorePending: false,
  });
});

test('RESET_REQUIRED replaces authoritative state before advancing checkpoint', async () => {
  const events = [];
  const queue = new FakeQueue(events);
  let resetSent = false;
  const transport = {
    async pull(checkpoint) {
      if (!resetSent) {
        resetSent = true;
        assert.equal(checkpoint, '0');
        return {
          protocolVersion: 1,
          error: 'RESET_REQUIRED',
          snapshotUrl: '/v1/sync/snapshot',
        };
      }
      assert.equal(checkpoint, '5');
      return {
        protocolVersion: 1,
        checkpoint: '5',
        hasMore: false,
        changes: [],
      };
    },
    async push() {
      throw new Error('push was not expected');
    },
    async snapshot(_signal, reset) {
      assert.equal(reset.error, 'RESET_REQUIRED');
      return {
        protocolVersion: 1,
        checkpoint: '5',
        records: [
          {
            table: 'docs',
            recordId: 'fresh',
            record: { fresh: true },
            revision: '2',
          },
        ],
      };
    },
  };
  const loop = new ProtocolSyncLoop(queue, transport, {
    async applyChanges() {},
    async replaceAuthoritative(records) {
      events.push(`replace:${records[0].recordId}`);
    },
  });

  const result = await loop.syncNow();
  assert.deepEqual(events.slice(0, 2), ['replace:fresh', 'checkpoint:5']);
  assert.equal(result.installedSnapshots, 1);
  assert.equal(result.checkpoint, '5');
});

test('a failed authoritative apply never advances the pull checkpoint', async () => {
  const events = [];
  const queue = new FakeQueue(events);
  const transport = {
    async pull() {
      return {
        protocolVersion: 1,
        checkpoint: '1',
        hasMore: false,
        changes: [change('1', 'unsafe')],
      };
    },
    async push() {
      throw new Error('push was not expected');
    },
    async snapshot() {
      throw new Error('snapshot was not expected');
    },
  };
  const loop = new ProtocolSyncLoop(queue, transport, {
    async applyChanges() {
      events.push('apply');
      throw new Error('injected authoritative-store failure');
    },
    async replaceAuthoritative() {},
  });

  await assert.rejects(loop.syncNow(), /authoritative-store failure/);
  assert.deepEqual(events, ['apply']);
  assert.equal(await queue.pullCheckpoint(), '0');
});

test('a failed snapshot replacement never advances the pull checkpoint', async () => {
  const events = [];
  const queue = new FakeQueue(events);
  const transport = {
    async pull() {
      return { protocolVersion: 1, error: 'RESET_REQUIRED' };
    },
    async push() {
      throw new Error('push was not expected');
    },
    async snapshot() {
      return {
        protocolVersion: 1,
        checkpoint: '8',
        records: [{
          table: 'docs',
          recordId: 'fresh',
          record: { fresh: true },
          revision: '1',
        }],
      };
    },
  };
  const loop = new ProtocolSyncLoop(queue, transport, {
    async applyChanges() {},
    async replaceAuthoritative() {
      events.push('replace');
      throw new Error('injected snapshot failure');
    },
  });

  await assert.rejects(loop.syncNow(), /snapshot failure/);
  assert.deepEqual(events, ['replace']);
  assert.equal(await queue.pullCheckpoint(), '0');
});

test('atomic callbacks own and must persist pull checkpoints', async () => {
  const events = [];
  const queue = new FakeQueue(events);
  let pulls = 0;
  const loop = new ProtocolSyncLoop(queue, {
    async pull() {
      pulls += 1;
      return {
        protocolVersion: 1,
        checkpoint: String(pulls),
        hasMore: false,
        changes: [change(String(pulls), `record-${pulls}`)],
      };
    },
    async push() {
      throw new Error('push was not expected');
    },
    async snapshot() {
      throw new Error('snapshot was not expected');
    },
  }, {
    async applyChanges() {
      throw new Error('non-atomic callback must not run');
    },
    async replaceAuthoritative() {},
    async applyChangesAndCheckpoint(changes, checkpoint) {
      events.push(`atomic:${changes[0].recordId}`);
      await queue.setPullCheckpoint(checkpoint);
    },
  });

  const result = await loop.syncNow();
  assert.deepEqual(events, [
    'atomic:record-1',
    'checkpoint:1',
    'atomic:record-2',
    'checkpoint:2',
  ]);
  assert.equal(result.checkpoint, '2');

  const unsafeQueue = new FakeQueue([]);
  const unsafe = new ProtocolSyncLoop(unsafeQueue, {
    async pull() {
      return {
        protocolVersion: 1,
        checkpoint: '1',
        hasMore: false,
        changes: [change('1', 'unsafe')],
      };
    },
    async push() {
      throw new Error('push was not expected');
    },
    async snapshot() {
      throw new Error('snapshot was not expected');
    },
  }, {
    async applyChanges() {},
    async replaceAuthoritative() {},
    async applyChangesAndCheckpoint() {
      // Deliberately violates the atomic callback contract.
    },
  });
  await assert.rejects(
    unsafe.syncNow(),
    (error) =>
      error instanceof SyncTransportError &&
      !error.retryable &&
      /did not persist/.test(error.message),
  );
});

test('malformed or regressing server pages fail permanently before application', async () => {
  for (const response of [
    {
      protocolVersion: 1,
      checkpoint: '0',
      hasMore: false,
      changes: [change('1', 'beyond-page-checkpoint')],
    },
    {
      protocolVersion: 1,
      checkpoint: '1',
      hasMore: 'false',
      changes: [],
    },
  ]) {
    const events = [];
    const queue = new FakeQueue(events);
    const loop = new ProtocolSyncLoop(queue, {
      async pull() {
        return response;
      },
      async push() {
        throw new Error('push was not expected');
      },
      async snapshot() {
        throw new Error('snapshot was not expected');
      },
    }, {
      async applyChanges() {
        events.push('apply');
      },
      async replaceAuthoritative() {
        events.push('replace');
      },
    });

    await assert.rejects(
      loop.syncNow(),
      (error) => error instanceof SyncTransportError && !error.retryable,
    );
    assert.deepEqual(events, []);
    assert.equal(await queue.pullCheckpoint(), '0');
  }
});

test('concurrent syncNow calls are single-flight', async () => {
  const events = [];
  const queue = new FakeQueue(events);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let pulls = 0;
  const transport = {
    async pull(checkpoint) {
      pulls += 1;
      if (pulls === 1) await gate;
      return {
        protocolVersion: 1,
        checkpoint,
        hasMore: false,
        changes: [],
      };
    },
    async push() {
      throw new Error('push was not expected');
    },
    async snapshot() {
      throw new Error('snapshot was not expected');
    },
  };
  const loop = new ProtocolSyncLoop(queue, transport, {
    async applyChanges() {},
    async replaceAuthoritative() {},
  });

  const first = loop.syncNow();
  const second = loop.syncNow();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(pulls, 2);
});

test('retry policy is bounded full jitter and honors Retry-After', () => {
  assert.equal(computeRetryDelay(1, 500, 30_000, () => 0), 0);
  assert.equal(computeRetryDelay(4, 500, 30_000, () => 1), 4000);
  assert.equal(computeRetryDelay(40, 500, 30_000, () => 1), 30_000);
  assert.equal(
    computeRetryDelay(2, 500, 30_000, () => 0.25, 12_000),
    12_000,
  );
  assert.throws(
    () => computeRetryDelay(1, 500, 30_000, () => 2),
    /random/,
  );
  assert.equal(
    new SyncTransportError('conflict', false).retryable,
    false,
  );
});
