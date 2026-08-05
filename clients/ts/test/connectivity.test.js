'use strict';

require('fake-indexeddb/auto');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BrowserConnectivityWatcher,
  ConnectivityAwareOptoSyncClient,
  ManualConnectivityWatcher,
} = require('../dist/index.js');

test('manual watcher deduplicates state and makes forced offline authoritative', () => {
  let now = 100;
  const watcher = new ManualConnectivityWatcher({
    initialState: 'unknown',
    now: () => ++now,
  });
  const transitions = [];
  watcher.subscribe(
    (next, previous) => transitions.push([previous.state, next.state, next.mode]),
    { emitCurrent: false },
  );

  watcher.publish('link');
  watcher.publish('link');
  watcher.setTotalOffline(true);
  watcher.publish('internet');

  assert.equal(watcher.snapshot().state, 'offline');
  assert.equal(watcher.snapshot().mode, 'offline');
  assert.deepEqual(transitions, [
    ['unknown', 'link', 'automatic'],
    ['link', 'offline', 'offline'],
  ]);

  watcher.setTotalOffline(false);
  assert.equal(watcher.snapshot().state, 'internet');
  assert.equal(watcher.snapshot().mode, 'automatic');
  assert.equal(transitions.length, 3);
});

test('browser watcher distinguishes link from verified internet and stops cleanly', async () => {
  const listeners = new Map();
  let fetches = 0;
  const host = {
    navigator: { onLine: true },
    location: {
      href: 'https://example.test/app',
      origin: 'https://example.test',
    },
    async fetch() {
      fetches += 1;
      return { ok: true };
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };

  const watcher = new BrowserConnectivityWatcher({
    host,
    probeUrl: '/health/reachability',
    probeIntervalMs: 0,
  });
  watcher.start();
  await watcher.refresh();

  assert.equal(watcher.snapshot().state, 'internet');
  assert.equal(fetches, 1);

  host.navigator.onLine = false;
  listeners.get('offline')?.({ type: 'offline' });
  assert.equal(watcher.snapshot().state, 'offline');

  watcher.setTotalOffline(true);
  host.navigator.onLine = true;
  listeners.get('online')?.({ type: 'online' });
  await watcher.refresh();
  assert.equal(watcher.snapshot().mode, 'offline');
  assert.equal(fetches, 1, 'forced offline must suppress active probes');

  watcher.stop();
  assert.equal(listeners.size, 0);
});

test('browser offline-mode restore revalidates before one internet transition', async () => {
  const listeners = new Map();
  let fetches = 0;
  const host = {
    navigator: { onLine: true },
    location: {
      href: 'https://example.test/app',
      origin: 'https://example.test',
    },
    async fetch() {
      fetches += 1;
      return { ok: true };
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const watcher = new BrowserConnectivityWatcher({
    host,
    probeUrl: '/health/reachability',
    probeIntervalMs: 0,
  });
  let wakeups = 0;
  const client = new ConnectivityAwareOptoSyncClient({
    databaseName: `browser-connectivity-restore-${Date.now()}`,
    stampUpdatedAt: false,
    connectivity: watcher,
    autoStartConnectivity: false,
    onMutationQueued: () => {
      wakeups += 1;
    },
  });
  const transitions = [];
  const unsubscribe = watcher.subscribe(
    (next, previous) => {
      transitions.push([previous.state, next.state, next.mode]);
    },
    { emitCurrent: false },
  );

  watcher.start();
  await watcher.refresh();
  assert.equal(watcher.snapshot().state, 'internet');
  assert.equal(wakeups, 1);

  wakeups = 0;
  transitions.length = 0;
  client.setTotalOffline(true);
  watcher.publish('internet', 'probe');
  client.setTotalOffline(false);
  await watcher.refresh();

  assert.equal(watcher.snapshot().state, 'internet');
  assert.equal(wakeups, 1, 'a reconnect should wake the sync loop once');
  assert.deepEqual(transitions, [
    ['internet', 'offline', 'offline'],
    ['offline', 'link', 'automatic'],
    ['link', 'internet', 'automatic'],
  ]);
  assert.ok(fetches >= 2);

  unsubscribe();
  watcher.stop();
  client.dispose();
  await client.db.delete();
});

test('browser probes must remain same-origin', () => {
  const host = {
    navigator: { onLine: true },
    location: {
      href: 'https://example.test/app',
      origin: 'https://example.test',
    },
    fetch: async () => ({ ok: true }),
    addEventListener() {},
    removeEventListener() {},
  };
  assert.throws(
    () =>
      new BrowserConnectivityWatcher({
        host,
        probeUrl: 'https://other.test/reachability',
      }),
    /same-origin/,
  );
});

test('connectivity-aware client emits post-commit save signals and honors total offline', async () => {
  const watcher = new ManualConnectivityWatcher({ initialState: 'internet' });
  const saves = [];
  const onlineSaves = [];
  const durabilityChecks = [];
  let wakeups = 0;
  let client;

  client = new ConnectivityAwareOptoSyncClient({
    databaseName: 'connectivity-aware-client',
    stampUpdatedAt: false,
    connectivity: watcher,
    onMutationQueued: () => {
      wakeups += 1;
    },
    onSave: (event) => {
      saves.push(event);
      durabilityChecks.push(
        client.db.localMutations.get(event.queueId).then((row) => row !== undefined),
      );
    },
    onOnlineSave: (event) => {
      onlineSaves.push(event);
    },
  });

  client.subscribeSave(() => {
    throw new Error('observer failures must not reject a committed save');
  });

  const firstId = await client.queueMutation('docs', 'online', { value: 1 });
  assert.ok(firstId > 0);
  assert.equal(saves.length, 1);
  assert.equal(onlineSaves.length, 1);
  assert.equal(wakeups, 1);
  assert.equal(saves[0].connectivity.state, 'internet');

  client.setTotalOffline(true);
  const secondId = await client.queueDelete('docs', 'offline');
  assert.ok(secondId > firstId);
  assert.equal(saves.length, 2);
  assert.equal(onlineSaves.length, 1);
  assert.equal(wakeups, 1, 'offline saves must not schedule network-bound work');
  assert.equal(saves[1].connectivity.mode, 'offline');

  watcher.publish('internet');
  client.setTotalOffline(false);
  assert.equal(wakeups, 2, 'restoring verified internet wakes the existing loop');

  assert.ok((await Promise.all(durabilityChecks)).every(Boolean));
  assert.equal((await client.pendingMutations()).length, 2);

  client.dispose();
  await client.db.delete();
});
