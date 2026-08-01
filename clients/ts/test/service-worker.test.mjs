import assert from 'node:assert/strict';
import test from 'node:test';

import { installOptoSyncServiceWorker } from '../dist/service-worker.js';

function fakeScope() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    emit(type, event) {
      listeners.get(type)?.(event);
    },
  };
}

function syncEvent(tag) {
  let captured;
  return {
    tag,
    waitUntil(promise) {
      captured = promise;
    },
    get waited() {
      return captured;
    },
  };
}

test('sync event with the configured tag drains exactly once per event', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: { syncNow: async () => ({ pushedMutations: ++cycles }) },
    }),
  });

  const event = syncEvent('opto-sync');
  scope.emit('sync', event);
  const result = await event.waited;
  assert.equal(result.pushedMutations, 1);
  assert.equal(cycles, 1);
});

test('sync event with a foreign tag is ignored', async () => {
  const scope = fakeScope();
  let created = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => {
      created += 1;
      return { loop: { syncNow: async () => ({}) } };
    },
  });
  const event = syncEvent('someone-elses-tag');
  scope.emit('sync', event);
  assert.equal(event.waited, undefined);
  assert.equal(created, 0);
});

test('a failed drain rejects waitUntil so the browser retries the tag', async () => {
  const scope = fakeScope();
  const seen = [];
  installOptoSyncServiceWorker({
    scope,
    onError: (error) => seen.push(error),
    createSession: () => ({
      loop: {
        syncNow: async () => {
          throw new Error('offline again');
        },
      },
    }),
  });
  const event = syncEvent('opto-sync');
  scope.emit('sync', event);
  await assert.rejects(event.waited, /offline again/);
  assert.equal(seen.length, 1);
});

test('session creation failure is retried on the next event, not cached', async () => {
  const scope = fakeScope();
  let attempts = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('wasm fetch failed');
      return { loop: { syncNow: async () => ({ ok: true }) } };
    },
  });

  const first = syncEvent('opto-sync');
  scope.emit('sync', first);
  await assert.rejects(first.waited, /wasm fetch failed/);

  const second = syncEvent('opto-sync');
  scope.emit('sync', second);
  assert.deepEqual(await second.waited, { ok: true });
  assert.equal(attempts, 2);
});

test('the session is created lazily and reused across events', async () => {
  const scope = fakeScope();
  let created = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => {
      created += 1;
      return { loop: { syncNow: async () => ({}) } };
    },
  });
  assert.equal(created, 0);

  for (let i = 0; i < 3; i += 1) {
    const event = syncEvent('opto-sync');
    scope.emit('sync', event);
    await event.waited;
  }
  assert.equal(created, 1);
});

test('periodicsync drains but swallows failures', async () => {
  const scope = fakeScope();
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: {
        syncNow: async () => {
          throw new Error('transient');
        },
      },
    }),
  });
  const event = syncEvent('opto-sync-periodic');
  scope.emit('periodicsync', event);
  await event.waited; // must not reject
});

test('message events reply on the provided port', async () => {
  const scope = fakeScope();
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: { syncNow: async () => ({ pulledChanges: 7 }) },
    }),
  });
  const replies = [];
  let waited;
  scope.emit('message', {
    data: { type: 'opto-sync:sync' },
    ports: [{ postMessage: (value) => replies.push(value) }],
    waitUntil: (promise) => {
      waited = promise;
    },
  });
  await waited;
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, true);
  assert.equal(replies[0].result.pulledChanges, 7);
});

test('dispose detaches every listener', () => {
  const scope = fakeScope();
  const handle = installOptoSyncServiceWorker({
    scope,
    createSession: () => ({ loop: { syncNow: async () => ({}) } }),
  });
  assert.equal(scope.listeners.size, 3);
  handle.dispose();
  assert.equal(scope.listeners.size, 0);
});

test('a message from a foreign origin is ignored', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({ loop: { syncNow: async () => ({ pushedMutations: ++cycles }) } }),
  });

  const replies = [];
  const port = { postMessage: (value) => replies.push(value) };
  let waited;
  scope.emit('message', {
    data: { type: 'opto-sync:sync' },
    origin: 'https://attacker.example',
    ports: [port],
    waitUntil: (promise) => {
      waited = promise;
    },
  });
  if (waited) await waited;

  assert.equal(cycles, 0, 'a cross-origin drain request must not touch the queue');
  assert.deepEqual(replies, [], 'a cross-origin sender must not receive the sync checkpoint');
});

test('a message carrying the worker origin still drains', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({ loop: { syncNow: async () => ({ pushedMutations: ++cycles }) } }),
  });

  const replies = [];
  let waited;
  scope.emit('message', {
    data: { type: 'opto-sync:sync' },
    // globalThis.origin is undefined under Node, which is exactly the
    // "host does not report an origin" case: the drain must still happen.
    origin: globalThis.origin ?? '',
    ports: [{ postMessage: (value) => replies.push(value) }],
    waitUntil: (promise) => {
      waited = promise;
    },
  });
  await waited;

  assert.equal(cycles, 1);
  assert.equal(replies[0].ok, true);
});

test('a sync event without waitUntil does not raise an unhandled rejection', async () => {
  const scope = fakeScope();
  const rejections = [];
  const capture = (error) => rejections.push(error);
  process.on('unhandledRejection', capture);
  try {
    installOptoSyncServiceWorker({
      scope,
      createSession: () => ({
        loop: {
          syncNow: async () => {
            throw new Error('offline');
          },
        },
      }),
    });
    scope.emit('sync', { tag: 'opto-sync' }); // no waitUntil on this event
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off('unhandledRejection', capture);
  }
  assert.deepEqual(rejections, [], 'a failed drain must not escape as an unhandled rejection');
});
