import assert from 'node:assert/strict';
import test from 'node:test';

import { startCrossTabCoordinator } from '../dist/cross-tab.js';

/** In-process Web Locks fake: exclusive, FIFO, abortable, auto-promoting. */
function fakeLockManager() {
  const queues = new Map();
  const runNext = (name) => {
    const queue = queues.get(name);
    if (!queue || queue.busy || queue.waiters.length === 0) return;
    const next = queue.waiters.shift();
    if (next.signal?.aborted) {
      next.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      runNext(name);
      return;
    }
    queue.busy = true;
    Promise.resolve()
      .then(() => next.callback())
      .then(next.resolve, next.reject)
      .finally(() => {
        queue.busy = false;
        runNext(name);
      });
  };
  return {
    request(name, options, callback) {
      if (!queues.has(name)) queues.set(name, { busy: false, waiters: [] });
      return new Promise((resolve, reject) => {
        queues
          .get(name)
          .waiters.push({ callback, resolve, reject, signal: options.signal });
        options.signal?.addEventListener?.('abort', () => {
          const queue = queues.get(name);
          const index = queue.waiters.findIndex((w) => w.signal === options.signal);
          if (index >= 0) {
            const [waiter] = queue.waiters.splice(index, 1);
            waiter.reject(
              Object.assign(new Error('aborted'), { name: 'AbortError' }),
            );
          }
        });
        runNext(name);
      });
    },
  };
}

/** Shared-bus BroadcastChannel fake. */
function fakeChannelBus() {
  const subscribers = new Set();
  return {
    factory: () => {
      const listeners = new Set();
      const channel = {
        listeners,
        postMessage(data) {
          for (const other of subscribers) {
            if (other === channel) continue; // BroadcastChannel skips self
            for (const listener of other.listeners) listener({ data });
          }
        },
        close() {
          subscribers.delete(channel);
        },
        addEventListener(_type, listener) {
          listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          listeners.delete(listener);
        },
      };
      subscribers.add(channel);
      return channel;
    },
  };
}

function fakeLoop() {
  return {
    hints: 0,
    started: 0,
    stopped: 0,
    hint() {
      this.hints += 1;
    },
    start() {
      this.started += 1;
    },
    stop() {
      this.stopped += 1;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('exactly one tab leads; hints route from follower to leader', async () => {
  const locks = fakeLockManager();
  const bus = fakeChannelBus();
  const loopA = fakeLoop();
  const loopB = fakeLoop();

  const tabA = startCrossTabCoordinator({
    loop: loopA,
    locks,
    broadcastChannelFactory: bus.factory,
  });
  await tick();
  const tabB = startCrossTabCoordinator({
    loop: loopB,
    locks,
    broadcastChannelFactory: bus.factory,
  });
  await tick();

  assert.equal(tabA.isLeader, true);
  assert.equal(tabB.isLeader, false);
  assert.equal(loopA.started, 1);
  assert.equal(loopB.started, 0);

  // A follower hint crosses the channel and wakes the leader's loop.
  tabB.hint();
  await tick();
  assert.equal(loopA.hints, 1);
  assert.equal(loopB.hints, 0);

  // Leader hints locally, no round-trip.
  tabA.hint();
  assert.equal(loopA.hints, 2);

  tabA.dispose();
  tabB.dispose();
});

test('leadership transfers when the leader tab goes away', async () => {
  const locks = fakeLockManager();
  const bus = fakeChannelBus();
  const loopA = fakeLoop();
  const loopB = fakeLoop();
  const changes = [];

  const tabA = startCrossTabCoordinator({
    loop: loopA,
    locks,
    broadcastChannelFactory: bus.factory,
    onLeadershipChange: (leads) => changes.push(['A', leads]),
  });
  await tick();
  const tabB = startCrossTabCoordinator({
    loop: loopB,
    locks,
    broadcastChannelFactory: bus.factory,
    onLeadershipChange: (leads) => changes.push(['B', leads]),
  });
  await tick();

  tabA.dispose(); // closing the leader releases the lock
  await tick();
  await tick();

  assert.equal(tabB.isLeader, true);
  assert.equal(loopA.stopped, 1);
  assert.equal(loopB.started, 1);
  assert.deepEqual(changes, [
    ['A', true],
    ['A', false],
    ['B', true],
  ]);
  tabB.dispose();
});

test('leader state broadcasts reach followers', async () => {
  const locks = fakeLockManager();
  const bus = fakeChannelBus();
  const seen = [];
  const leader = startCrossTabCoordinator({
    loop: fakeLoop(),
    locks,
    broadcastChannelFactory: bus.factory,
  });
  await tick();
  const follower = startCrossTabCoordinator({
    loop: fakeLoop(),
    locks,
    broadcastChannelFactory: bus.factory,
    onRemoteState: (state) => seen.push(state),
  });
  await tick();

  leader.publishState({ status: 'syncing', consecutiveFailures: 0 });
  await tick();
  assert.deepEqual(seen, [{ status: 'syncing', consecutiveFailures: 0 }]);
  leader.dispose();
  follower.dispose();
});

test('without Web Locks every tab leads (single-tab baseline)', async () => {
  const loop = fakeLoop();
  const coordinator = startCrossTabCoordinator({
    loop,
    locks: undefined,
    broadcastChannelFactory: fakeChannelBus().factory,
  });
  assert.equal(coordinator.isLeader, true);
  assert.equal(loop.started, 1);
  coordinator.dispose();
  assert.equal(loop.stopped, 1);
});
