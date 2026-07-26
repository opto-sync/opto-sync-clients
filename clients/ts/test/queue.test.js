'use strict';

// Dexie mutation-queue tests, run in Node against fake-indexeddb.
require('fake-indexeddb/auto');

const test = require('node:test');
const assert = require('node:assert');

const {
  OptoSyncClient,
  QueueQuotaError,
  SYNC_STATUS,
  ArrayStrategy,
} = require('../dist/index.js');

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

test('observeIncoming follows nested JSON-Pointer timestamp selectors', async () => {
  const client = new OptoSyncClient({
    databaseName: 'queue-observe-json-pointer',
    lwwKeys: '#/_sync/updatedAt',
  });
  const remote = '9999999999999-00ff-peer';
  await assert.rejects(
    () =>
      client.observeIncoming({
        rows: [{ id: 'a', _sync: { updatedAt: remote } }],
      }),
    /ahead of local time/,
    'the nested timestamp must reach the bounded HLC observer',
  );
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

test('queue quotas refuse work before consuming mutation ids', async () => {
  const client = new OptoSyncClient({
    databaseName: 'queue-quotas',
    stampUpdatedAt: false,
    maxPendingMutations: 2,
    maxQueuedPayloadBytes: 32,
  });

  await assert.rejects(
    () =>
      client.queueMutation('docs', 'large', {
        text: 'this payload is intentionally too large',
      }),
    (error) =>
      error instanceof QueueQuotaError && error.code === 'PAYLOAD_TOO_LARGE',
  );
  await client.queueMutation('docs', 'r1', { v: 1 });
  await client.queueMutation('docs', 'r2', { v: 2 });
  await assert.rejects(
    () => client.queueDelete('docs', 'r3'),
    (error) => error instanceof QueueQuotaError && error.code === 'QUEUE_FULL',
  );

  const request = await client.protocolPushRequest();
  assert.deepStrictEqual(
    request.mutations.map((mutation) => mutation.mutationId),
    ['1', '2'],
    'refused writes must not create gaps in the dedupe sequence',
  );
  await client.db.delete();
});

test('concurrent writers cannot race past the pending queue limit', async () => {
  const client = new OptoSyncClient({
    databaseName: 'queue-quota-concurrency',
    stampUpdatedAt: false,
    maxPendingMutations: 1,
  });
  const results = await Promise.allSettled([
    client.queueMutation('docs', 'r1', { v: 1 }),
    client.queueMutation('docs', 'r2', { v: 2 }),
  ]);

  assert.strictEqual(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const refused = results.find((result) => result.status === 'rejected');
  assert.ok(
    refused.reason instanceof QueueQuotaError &&
      refused.reason.code === 'QUEUE_FULL',
  );
  const request = await client.protocolPushRequest();
  assert.strictEqual(request.mutations.length, 1);
  assert.strictEqual(request.mutations[0].mutationId, '1');
  await client.db.delete();
});

test('pruneConfirmed removes oldest history but never pending work', async () => {
  const client = new OptoSyncClient({
    databaseName: 'queue-prune-confirmed',
    stampUpdatedAt: false,
  });
  const first = await client.queueDelete('docs', 'r1');
  const second = await client.queueDelete('docs', 'r2');
  await client.queueDelete('docs', 'r3');
  await client.markMutation(first, SYNC_STATUS.SYNCED);
  await client.markMutation(second, SYNC_STATUS.SYNCED);

  assert.strictEqual(await client.pruneConfirmed(1), 1);
  const rows = await client.db.localMutations.orderBy('id').toArray();
  assert.deepStrictEqual(
    rows.map((row) => [row.recordId, row.syncStatus]),
    [
      ['r2', SYNC_STATUS.SYNCED],
      ['r3', SYNC_STATUS.PENDING],
    ],
  );
  await client.db.delete();
});

test('durable queue commits wake the attached background loop without trusting it', async () => {
  let wakeups = 0;
  const client = new OptoSyncClient({
    databaseName: 'queue-background-trigger',
    stampUpdatedAt: false,
    onMutationQueued: () => {
      wakeups += 1;
    },
  });
  await client.queueMutation('docs', 'r1', { value: 1 });
  client.setBackgroundSyncTrigger(() => {
    wakeups += 1;
    throw new Error('a wake-up hint must not undo the queue commit');
  });
  await client.queueDelete('docs', 'r2');

  assert.strictEqual(wakeups, 2);
  assert.strictEqual((await client.pendingMutations()).length, 2);
  await client.db.delete();
});

test('IndexedDB optimistic rows and queue entries commit or roll back together', async () => {
  let wakeups = 0;
  const client = new OptoSyncClient({
    databaseName: 'queue-atomic-optimistic-write',
    stampUpdatedAt: false,
    onMutationQueued: () => {
      wakeups += 1;
    },
  });
  client.db.version(4).stores({
    authoritativeRecords: '&key',
  });
  const records = client.db.table('authoritativeRecords');

  await client.queueMutationAtomic(
    'docs',
    'r1',
    { value: 1 },
    [records],
    async (payload) => {
      await records.put({ key: 'docs/r1', payload });
    },
  );
  assert.deepStrictEqual(await records.get('docs/r1'), {
    key: 'docs/r1',
    payload: { value: 1 },
  });
  assert.strictEqual((await client.pendingMutations()).length, 1);

  await assert.rejects(
    () =>
      client.queueMutationAtomic(
        'docs',
        'rollback',
        { value: 2 },
        [records],
        async (payload) => {
          await records.put({ key: 'docs/rollback', payload });
          throw new Error('injected optimistic write failure');
        },
      ),
    /injected optimistic write failure/,
  );
  assert.strictEqual(
    await records.get('docs/rollback'),
    undefined,
    'application row must roll back with the queue insert',
  );
  assert.strictEqual(
    (await client.pendingMutations()).length,
    1,
    'failed application transaction must not leave pending intent',
  );

  await client.queueDeleteAtomic('docs', 'r1', [records], async () => {
    await records.delete('docs/r1');
  });
  assert.strictEqual(await records.get('docs/r1'), undefined);
  const request = await client.protocolPushRequest();
  assert.deepStrictEqual(
    request.mutations.map((mutation) => mutation.mutationId),
    ['1', '2'],
    'rolled-back optimistic writes must not consume protocol sequence ids',
  );
  assert.strictEqual(wakeups, 2, 'only committed transactions wake the loop');
  await client.db.delete();
});

test('IndexedDB pull pages and snapshots commit with their checkpoints', async () => {
  const client = new OptoSyncClient({
    databaseName: 'queue-atomic-pull-checkpoint',
    stampUpdatedAt: false,
  });
  client.db.version(4).stores({ authoritativeRecords: '&key' });
  const records = client.db.table('authoritativeRecords');

  await client.commitPullPageAtomic('7', [records], async () => {
    await records.put({ key: 'docs/r1', record: { value: 1 } });
  });
  assert.strictEqual(await client.pullCheckpoint(), '7');
  assert.deepStrictEqual(await records.get('docs/r1'), {
    key: 'docs/r1',
    record: { value: 1 },
  });

  await assert.rejects(
    () =>
      client.commitPullPageAtomic('8', [records], async () => {
        await records.put({ key: 'docs/rollback', record: { value: 2 } });
        throw new Error('injected pull application failure');
      }),
    /injected pull application failure/,
  );
  assert.strictEqual(await client.pullCheckpoint(), '7');
  assert.strictEqual(await records.get('docs/rollback'), undefined);

  const snapshot = {
    protocolVersion: 1,
    checkpoint: '9',
    records: [
      {
        table: 'docs',
        recordId: 'snapshot',
        record: { value: 9 },
        revision: '1',
      },
    ],
  };
  await client.installSnapshotAtomic(snapshot, [records], async (entries) => {
    await records.clear();
    await records.bulkPut(
      entries.map((entry) => ({
        key: `${entry.table}/${entry.recordId}`,
        record: entry.record,
      })),
    );
  });
  assert.strictEqual(await client.pullCheckpoint(), '9');
  assert.deepStrictEqual(await records.toArray(), [
    { key: 'docs/snapshot', record: { value: 9 } },
  ]);

  await assert.rejects(
    () =>
      client.installSnapshotAtomic(
        { ...snapshot, checkpoint: '10' },
        [records],
        async () => {
          await records.clear();
          throw new Error('injected snapshot replacement failure');
        },
      ),
    /injected snapshot replacement failure/,
  );
  assert.strictEqual(await client.pullCheckpoint(), '9');
  assert.deepStrictEqual(await records.toArray(), [
    { key: 'docs/snapshot', record: { value: 9 } },
  ]);
  await client.db.delete();
});
