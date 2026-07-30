import assert from 'node:assert/strict';
import test from 'node:test';

import { registerBackgroundSync } from '../dist/register-sw.js';

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

function fakeContainer(registration) {
  const calls = [];
  return {
    calls,
    register(url, options) {
      calls.push({ url, options });
      return Promise.resolve(registration);
    },
    ready: Promise.resolve(registration),
  };
}

test('uses Background Sync when the registration exposes sync', async () => {
  const tags = [];
  const registration = {
    sync: { register: async (tag) => void tags.push(tag) },
  };
  const handle = await registerBackgroundSync({
    serviceWorkerUrl: '/sw.js',
    serviceWorkerContainer: fakeContainer(registration),
  });
  assert.equal(handle.strategy, 'background-sync');
  assert.equal(handle.periodic, false);
  await handle.requestSync();
  assert.deepEqual(tags, ['opto-sync']);
});

test('registers periodic sync only when permission is granted', async () => {
  const periodic = [];
  const registration = {
    sync: { register: async () => undefined },
    periodicSync: {
      register: async (tag, options) => void periodic.push({ tag, options }),
    },
  };
  const granted = await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer(registration),
    permissions: { query: async () => ({ state: 'granted' }) },
    periodicMinIntervalMs: 60_000,
  });
  assert.equal(granted.periodic, true);
  assert.deepEqual(periodic, [
    { tag: 'opto-sync-periodic', options: { minInterval: 60_000 } },
  ]);

  const denied = await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer(registration),
    permissions: { query: async () => ({ state: 'denied' }) },
  });
  assert.equal(denied.periodic, false);
});

test('falls back to the in-page loop when Background Sync is missing', async () => {
  const loop = fakeLoop();
  const handle = await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer({}),
    loop,
  });
  assert.equal(handle.strategy, 'in-page');
  assert.equal(loop.started, 1);
  await handle.requestSync();
  assert.equal(loop.hints, 1);
  handle.dispose();
  assert.equal(loop.stopped, 1);
});

test('in-page fallback without a loop is a hard error', async () => {
  await assert.rejects(
    registerBackgroundSync({ serviceWorkerContainer: fakeContainer({}) }),
    /requires `loop`/,
  );
});

test('a sync.register failure degrades to the loop instead of rejecting', async () => {
  const loop = fakeLoop();
  const registration = {
    sync: {
      register: async () => {
        throw new Error('permission denied');
      },
    },
  };
  const handle = await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer(registration),
    loop,
  });
  await handle.requestSync(); // must not reject
  assert.equal(loop.hints, 1);
});

test('wires the client queue trigger to requestSync and unwires on dispose', async () => {
  let trigger;
  const client = {
    setBackgroundSyncTrigger(fn) {
      trigger = fn;
    },
  };
  const tags = [];
  const registration = { sync: { register: async (tag) => void tags.push(tag) } };
  const handle = await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer(registration),
    client,
  });
  assert.equal(typeof trigger, 'function');
  trigger();
  await Promise.resolve();
  assert.deepEqual(tags, ['opto-sync']);
  handle.dispose();
  assert.equal(trigger, undefined);
});

test('foreground loop runs alongside Background Sync by default', async () => {
  const loop = fakeLoop();
  const registration = { sync: { register: async () => undefined } };
  await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer(registration),
    loop,
  });
  assert.equal(loop.started, 1);

  const without = fakeLoop();
  await registerBackgroundSync({
    serviceWorkerContainer: fakeContainer(registration),
    loop: without,
    runLoopInForeground: false,
  });
  assert.equal(without.started, 0);
});
