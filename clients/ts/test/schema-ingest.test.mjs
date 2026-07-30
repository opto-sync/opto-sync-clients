import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OptoSyncClient, schema } from '../dist/index.js';

const { parseEnvelope, ingestEnvelope, IngestValidationError } = schema;

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../schema/fixtures',
);

test('accepts every shared valid fixture (cross-language corpus)', async () => {
  const dir = path.join(fixturesDir, 'valid');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3);
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    const envelope = await parseEnvelope(raw);
    assert.equal(envelope.formatVersion, 1, file);
  }
});

test('rejects every shared invalid fixture (cross-language corpus)', async () => {
  const dir = path.join(fixturesDir, 'invalid');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 4);
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    await assert.rejects(
      parseEnvelope(raw),
      IngestValidationError,
      `expected ${file} to be rejected`,
    );
  }
});

test('accepts Blob-like inputs', async () => {
  const raw = await readFile(
    path.join(fixturesDir, 'valid/basic-upsert.json'),
    'utf8',
  );
  const blobLike = { text: async () => raw };
  const envelope = await parseEnvelope(blobLike);
  assert.equal(envelope.records.length, 1);
});

let databaseSequence = 0;
function makeClient() {
  databaseSequence += 1;
  return new OptoSyncClient({
    databaseName: `ingest-test-${databaseSequence}`,
    // Envelope payloads carry their own updatedAt; ingest must not restamp.
    stampUpdatedAt: false,
  });
}

test('ingestEnvelope queues one mutation per record, in file order', async () => {
  const client = makeClient();
  const raw = await readFile(
    path.join(fixturesDir, 'valid/nested-keyed-arrays.json'),
    'utf8',
  );
  const { receipts } = await ingestEnvelope(client, raw, { optimism: 'background' });
  assert.equal(receipts.length, 2);

  const pending = await client.pendingMutations();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].operation, 'upsert');
  assert.equal(pending[0].recordId, 'doc-9');
  assert.equal(pending[0].baseRevision, '41');
  const payload = JSON.parse(pending[0].jsonPayload);
  assert.equal(payload.sections.length, 2);
  assert.equal(pending[1].operation, 'delete');
  assert.equal(pending[1].recordId, 'doc-10');
});

test('nothing queues when any record is invalid', async () => {
  const client = makeClient();
  const raw = await readFile(
    path.join(fixturesDir, 'invalid/missing-updated-at.json'),
    'utf8',
  );
  await assert.rejects(ingestEnvelope(client, raw), IngestValidationError);
  assert.equal((await client.pendingMutations()).length, 0);
});
