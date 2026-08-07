import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_SYNC_TAG,
  SYNC_FAILURE_CODE,
  installOptoSyncServiceWorker,
} from '../dist/service-worker.js';

function fakeScope(origin) {
  const listeners = new Map();
  return {
    listeners,
    origin,
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

test('concurrent worker events share one adapter-owned drain', async () => {
  const scope = fakeScope();
  let cycles = 0;
  let release;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: {
        syncNow: async () => {
          cycles += 1;
          await new Promise((resolve) => {
            release = resolve;
          });
          return { pushedMutations: cycles };
        },
      },
    }),
  });

  const first = syncEvent('opto-sync');
  const second = syncEvent('opto-sync');
  scope.emit('sync', first);
  scope.emit('sync', second);
  assert.strictEqual(first.waited, second.waited);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cycles, 1);
  release();
  await Promise.all([first.waited, second.waited]);

  const later = syncEvent('opto-sync');
  scope.emit('sync', later);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cycles, 2, 'a later event starts a new drain');
  release();
  await later.waited;
});

test('the legacy reactive tag remains drainable across a worker upgrade', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: { syncNow: async () => ({ pushedMutations: ++cycles }) },
    }),
  });

  const event = syncEvent(LEGACY_SYNC_TAG);
  scope.emit('sync', event);
  assert.equal((await event.waited).pushedMutations, 1);
});

test('explicit additional tags override the default migration alias', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    additionalSyncTags: ['tenant-sync'],
    createSession: () => ({
      loop: { syncNow: async () => ({ pushedMutations: ++cycles }) },
    }),
  });

  const legacy = syncEvent(LEGACY_SYNC_TAG);
  scope.emit('sync', legacy);
  assert.equal(legacy.waited, undefined);

  const tenant = syncEvent('tenant-sync');
  scope.emit('sync', tenant);
  await tenant.waited;
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

test('an observability callback cannot replace the retryable sync failure', async () => {
  const scope = fakeScope();
  installOptoSyncServiceWorker({
    scope,
    onError() {
      throw new Error('broken logger');
    },
    createSession: () => ({
      loop: {
        syncNow: async () => {
          throw new Error('network offline');
        },
      },
    }),
  });

  const event = syncEvent('opto-sync');
  scope.emit('sync', event);
  await assert.rejects(event.waited, /network offline/);
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

test('message failures are bounded and never echo transport secrets', async () => {
  const scope = fakeScope();
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: {
        syncNow: async () => {
          throw new Error('Bearer secret-token at postgres://tenant.example');
        },
      },
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
  assert.deepEqual(replies, [{ ok: false, error: SYNC_FAILURE_CODE }]);
  assert.doesNotMatch(JSON.stringify(replies), /secret-token|postgres/);
});

test('a detached message port cannot turn a completed drain into a failure', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: { syncNow: async () => ({ pushedMutations: ++cycles }) },
    }),
  });
  let waited;
  scope.emit('message', {
    data: { type: 'opto-sync:sync' },
    ports: [
      {
        postMessage() {
          throw new Error('MessagePort is detached');
        },
      },
    ],
    waitUntil: (promise) => {
      waited = promise;
    },
  });

  await waited;
  assert.equal(cycles, 1);
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
  const scope = fakeScope('https://app.example');
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
  const scope = fakeScope('https://app.example');
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({ loop: { syncNow: async () => ({ pushedMutations: ++cycles }) } }),
  });

  const replies = [];
  let waited;
  scope.emit('message', {
    data: { type: 'opto-sync:sync' },
    origin: 'https://app.example',
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

test('periodicsync still drains safely when a synthetic host lacks waitUntil', async () => {
  const scope = fakeScope();
  let cycles = 0;
  installOptoSyncServiceWorker({
    scope,
    createSession: () => ({
      loop: { syncNow: async () => void (cycles += 1) },
    }),
  });
  scope.emit('periodicsync', { tag: 'opto-sync-periodic' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cycles, 1);
});
