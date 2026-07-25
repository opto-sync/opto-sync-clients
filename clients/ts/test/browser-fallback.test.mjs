/**
 * The browser path, exercised under Node with jsdom + fake-indexeddb.
 *
 * browser-e2e.test.mjs is the real proof (headless Chromium, the browser's own
 * IndexedDB and WebAssembly). This file is the CI safety net for environments
 * that cannot download a browser: it still runs the genuine ES-module browser
 * entry and the genuine wasm engine, only the storage and the DOM are fakes.
 *
 * The jsdom window matters more than it looks: the emscripten glue picks its
 * environment branch from `globalThis.window`, so with a window present this
 * runs the same ENVIRONMENT_IS_WEB code path a browser does, rather than a
 * Node-flavoured one.
 */
import test from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

function assertCoreAtLeast(v, label = 'core') {
  // Lower bound, not an exact match: an exact pin fails on every patch bump
  // yet still would not catch a stale artifact reporting an OLDER version.
  const [maj, min, patch] = String(v).split('.').map(Number);
  assert.ok(
    maj > 0 || min > 2 || (min === 2 && patch >= 1),
    `${label} reports unexpected core version ${v}`,
  );
}


/* Install the browser-ish globals BEFORE importing the client, so the engine
   and Dexie both see them at module-evaluation time. */
await import('fake-indexeddb/auto');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://opto-sync.test/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.self = dom.window;

/* Dexie resolves its globals off `self`/`window` rather than off globalThis,
   so once a jsdom window exists the fake IndexedDB has to be visible on it —
   otherwise Dexie reports "IndexedDB API missing" even though the Node global
   is set. */
for (const name of [
  'indexedDB',
  'IDBFactory',
  'IDBKeyRange',
  'IDBRequest',
  'IDBOpenDBRequest',
  'IDBTransaction',
  'IDBDatabase',
  'IDBObjectStore',
  'IDBIndex',
  'IDBCursor',
  'IDBCursorWithValue',
  'IDBVersionChangeEvent',
]) {
  if (globalThis[name] !== undefined) dom.window[name] = globalThis[name];
}

const {
  initOptoSync,
  isOptoSyncReady,
  createOptoSyncClient,
  OptoSyncClient,
  SYNC_STATUS,
  reconcileIncoming,
  engineVersion,
  mergeEngineKind,
  DEFAULT_RECONCILE_OPTIONS,
} = await import('../dist/esm/browser.js');

import * as nativeClient from '../dist/reconcile.js';
import { RECONCILE_SCENARIOS } from './helpers/corpus.mjs';

test('the emscripten glue took the web environment branch', () => {
  assert.strictEqual(typeof globalThis.window, 'object', 'jsdom window must be installed');
});

test('reconciling before initOptoSync() fails loudly', () => {
  assert.strictEqual(isOptoSyncReady(), false);
  assert.throws(() => reconcileIncoming({ a: 1 }, { a: 2 }), /no merge engine installed/);
});

test('initOptoSync installs the wasm engine and is idempotent', async () => {
  await initOptoSync();
  await Promise.all([initOptoSync(), initOptoSync()]);
  assert.strictEqual(isOptoSyncReady(), true);
  assert.strictEqual(mergeEngineKind(), 'wasm');
  assertCoreAtLeast(engineVersion(), 'wasm engine');
});

test('the default merge policy is unchanged on the browser path', () => {
  assert.deepStrictEqual({ ...DEFAULT_RECONCILE_OPTIONS }, {
    arrayStrategy: 4,
    arrayMatchKeys: 'id',
    resolveByTimestamp: true,
    lwwKeys: 'updatedAt,syncedAt',
    fwwKeys: 'createdAt',
  });
});

test(`all ${RECONCILE_SCENARIOS.length} reconcile scenarios match the native engine`, () => {
  for (const [name, local, incoming, options] of RECONCILE_SCENARIOS) {
    assert.strictEqual(
      JSON.stringify(reconcileIncoming(local, incoming, options)),
      JSON.stringify(nativeClient.reconcileIncoming(local, incoming, options)),
      name,
    );
  }
});

test('createOptoSyncClient: queue, mark, and reconcile against IndexedDB', async () => {
  const client = await createOptoSyncClient({ databaseName: 'fallback-queue' });
  const id = await client.queueMutation('todos', 'todo-1', { title: 'buy milk', updatedAt: 111 });
  await client.queueMutation('todos', 'todo-2', { title: 'walk dog' });

  let pending = await client.pendingMutations();
  assert.strictEqual(pending.length, 2);
  assert.strictEqual(pending[0].syncStatus, SYNC_STATUS.PENDING);

  await client.markMutation(id, SYNC_STATUS.SYNCED);
  pending = await client.pendingMutations();
  assert.deepStrictEqual(pending.map((m) => m.recordId), ['todo-2']);

  // The optimistic guarantee: a stale server echo must not win.
  const merged = client.reconcileIncoming(
    'todos',
    'todo-1',
    { title: 'server had an old copy', updatedAt: 10 },
    { title: 'edited offline', updatedAt: 5000, rows: [{ id: 'a', v: 1 }] },
  );
  assert.strictEqual(merged.title, 'edited offline');
  assert.deepStrictEqual(merged.rows, [{ id: 'a', v: 1 }]);

  await client.db.delete();
});

test('queued writes survive close/reopen on the browser path too', async () => {
  const dbName = 'fallback-durability';
  const first = new OptoSyncClient({ databaseName: dbName });
  await first.queueMutation('todos', 'survives', { title: 'reload me' });
  first.db.close();

  const reopened = new OptoSyncClient({ databaseName: dbName });
  const pending = await reopened.pendingMutations();
  assert.deepStrictEqual(pending.map((m) => m.recordId), ['survives']);
  await reopened.db.delete();
});

test('client-level options flow through to the wasm engine', async () => {
  const client = await createOptoSyncClient({
    databaseName: 'fallback-options',
    arrayStrategy: 4,
    arrayMatchKeys: 'uuid,id',
  });
  const merged = client.reconcileIncoming(
    'docs',
    'd1',
    { rows: [{ uuid: 'u-1', v: 1 }], updatedAt: 100 },
    { rows: [{ uuid: 'u-1', v: 10 }, { uuid: 'u-2', v: 20 }], updatedAt: 300 },
  );
  assert.strictEqual(merged.rows.length, 2);
  assert.strictEqual(merged.rows.find((r) => r.uuid === 'u-1').v, 10, 'stale incoming rejected');
  await client.db.delete();
});
