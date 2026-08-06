'use strict';

require('fake-indexeddb/auto');

const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OptimismLevel,
  OptoSyncClient,
  QueueQuotaError,
  SyncIngestValidationError,
  ingestSyncDocument,
  parseSyncIngestDocument,
  syncIngestDocumentSchema,
} = require('../dist/index.js');

const validFixturePath = path.resolve(
  __dirname,
  '../../../schemas/fixtures/ingest.valid.json',
);
const invalidFixturePath = path.resolve(
  __dirname,
  '../../../schemas/fixtures/ingest.invalid.json',
);

test('shared ingest fixture validates from JSON, Blob, and bytes', async () => {
  const json = await fs.readFile(validFixturePath, 'utf8');
  const expected = JSON.parse(json);
  const fromJson = await parseSyncIngestDocument(json);
  const fromBlob = await parseSyncIngestDocument(
    new Blob([json], { type: 'application/json' }),
  );
  const fromBytes = await parseSyncIngestDocument(
    new TextEncoder().encode(json),
  );

  assert.deepEqual(fromJson, expected);
  assert.deepEqual(fromBlob, expected);
  assert.deepEqual(fromBytes, expected);
  assert.equal(syncIngestDocumentSchema.safeParse(expected).success, true);
});

test('all shared malformed fixtures fail before touching IndexedDB', async () => {
  const cases = JSON.parse(await fs.readFile(invalidFixturePath, 'utf8'));
  const client = new OptoSyncClient({
    databaseName: 'ingest-invalid-fixtures',
  });

  for (const fixture of cases) {
    await assert.rejects(
      () => ingestSyncDocument({ input: fixture.document, client }),
      SyncIngestValidationError,
      fixture.name,
    );
  }
  assert.deepEqual(await client.pendingMutations(), []);
  await client.db.delete();
});

test('durable ingest queues the full batch atomically with contiguous ids', async () => {
  const input = await fs.readFile(validFixturePath, 'utf8');
  let wakes = 0;
  const client = new OptoSyncClient({
    databaseName: 'ingest-durable-batch',
    onMutationQueued: () => {
      wakes += 1;
    },
  });

  const result = await ingestSyncDocument({ input, client });
  const pending = await client.pendingMutations();

  assert.equal(result.document.batchId, 'import-2026-07-30');
  assert.equal(result.write.optimism, OptimismLevel.DurableLocal);
  assert.deepEqual(result.write.local, pending.map((row) => row.id));
  assert.deepEqual(
    pending.map((row) => row.mutationId),
    ['1', '2'],
  );
  assert.deepEqual(
    pending.map((row) => row.operation),
    ['upsert', 'delete'],
  );
  assert.equal(
    JSON.parse(pending[0].jsonPayload).updatedAt,
    '1721822400000-0000-device.tab',
  );
  assert.equal(wakes, 1);
  await client.db.delete();
});

test('a batch that exceeds queue quota leaves no partial mutations', async () => {
  const input = await fs.readFile(validFixturePath, 'utf8');
  const client = new OptoSyncClient({
    databaseName: 'ingest-atomic-quota',
    maxPendingMutations: 1,
  });

  await assert.rejects(
    () => ingestSyncDocument({ input, client }),
    (error) =>
      error instanceof QueueQuotaError && error.code === 'QUEUE_FULL',
  );
  assert.deepEqual(await client.pendingMutations(), []);
  await client.db.delete();
});

test('server-confirmed ingest validates and bypasses the local queue', async () => {
  const input = await fs.readFile(validFixturePath, 'utf8');
  const client = new OptoSyncClient({
    databaseName: 'ingest-server-confirmed',
  });
  let received;

  const result = await ingestSyncDocument({
    input,
    client,
    optimism: OptimismLevel.ServerConfirmed,
    remoteIngest: async (document) => {
      received = document;
      return { accepted: document.mutations.length };
    },
  });

  assert.equal(received.batchId, 'import-2026-07-30');
  assert.deepEqual(result.write.remote, { accepted: 2 });
  assert.deepEqual(await client.pendingMutations(), []);
  await client.db.delete();
});
