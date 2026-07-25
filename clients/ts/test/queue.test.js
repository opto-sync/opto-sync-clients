'use strict';

// Dexie mutation-queue tests, run in Node against fake-indexeddb.
require('fake-indexeddb/auto');

const test = require('node:test');
const assert = require('node:assert');

const { OptoSyncClient, SYNC_STATUS, ArrayStrategy } = require('../dist/index.js');

test('queueMutation stores a pending mutation and pendingMutations returns it', async () => {
  const client = new OptoSyncClient({ databaseName: 'queue-test-1' });
  const id = await client.queueMutation('todos', 'todo-1', { title: 'buy milk', updatedAt: 111 });
  assert.ok(typeof id === 'number' && id > 0);

  const pending = await client.pendingMutations();
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].tableName, 'todos');
  assert.strictEqual(pending[0].recordId, 'todo-1');
  assert.strictEqual(pending[0].syncStatus, SYNC_STATUS.PENDING);
  assert.deepStrictEqual(JSON.parse(pending[0].jsonPayload), { title: 'buy milk', updatedAt: 111 });
  await client.db.delete();
});

test('markMutation moves a mutation out of the pending set', async () => {
  const client = new OptoSyncClient({ databaseName: 'queue-test-2' });
  const id1 = await client.queueMutation('todos', 'a', { updatedAt: 1 });
  await client.queueMutation('notes', 'b', { updatedAt: 2 });

  await client.markMutation(id1, SYNC_STATUS.SYNCED);
  const pending = await client.pendingMutations();
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].tableName, 'notes');

  const onlyTodos = await client.pendingMutations('todos');
  assert.strictEqual(onlyTodos.length, 0);
  await client.db.delete();
});

test('client-level reconcile options flow through to the native engine', async () => {
  const client = new OptoSyncClient({
    databaseName: 'queue-test-3',
    arrayStrategy: ArrayStrategy.MERGE_BY_KEY,
    arrayMatchKeys: 'uuid,id',
  });
  const merged = client.reconcileIncoming(
    'docs',
    'd1',
    { rows: [{ uuid: 'u-1', v: 10 }, { uuid: 'u-2', v: 20 }], updatedAt: 300 },
    { rows: [{ uuid: 'u-1', v: 1 }], updatedAt: 100 },
  );
  assert.strictEqual(merged.rows.length, 2);
  assert.strictEqual(merged.rows.find((r) => r.uuid === 'u-1').v, 10);
  await client.db.delete();
});

test('queued mutations survive closing and reopening the database', async () => {
  // The point of an optimistic local-first queue is that a write survives the
  // tab or app being closed before it reaches the server. Dexie is closed here
  // and a brand-new client opens the same named database, as a reload would.
  const dbName = 'queue-durability';
  const first = new OptoSyncClient({ databaseName: dbName });
  const keptId = await first.queueMutation('todos', 'todo-durable', {
    title: 'survive a reload',
    updatedAt: 222,
  });
  await first.queueMutation('todos', 'todo-durable-2', { title: 'also survive' });
  first.db.close();

  const reopened = new OptoSyncClient({ databaseName: dbName });
  const pending = await reopened.pendingMutations();
  assert.strictEqual(pending.length, 2, 'both pending writes must be recovered');
  assert.deepStrictEqual(
    pending.map((m) => m.recordId).sort(),
    ['todo-durable', 'todo-durable-2'],
  );
  assert.ok(
    pending.every((m) => m.syncStatus === SYNC_STATUS.PENDING),
    'recovered writes are still pending, not silently marked synced',
  );

  // A status transition must be durable too, or a reload would re-send work
  // the server already accepted.
  await reopened.markMutation(keptId, SYNC_STATUS.SYNCED);
  reopened.db.close();

  const third = new OptoSyncClient({ databaseName: dbName });
  const stillPending = await third.pendingMutations();
  assert.deepStrictEqual(
    stillPending.map((m) => m.recordId),
    ['todo-durable-2'],
    'the synced mutation must not come back as pending',
  );
  await third.db.delete();
});
