import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schema } from '../dist/index.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../schema/fixtures',
);

const {
  IngestValidationError,
  ajvProvider,
  auditEnvelopeProvider,
  callbackProvider,
  parseEnvelope,
  standardSchemaProvider,
} = schema;

async function fixture(kind, name) {
  return readFile(path.join(fixturesDir, kind, name), 'utf8');
}

test('normalizes JSON parser failures', async () => {
  await assert.rejects(
    parseEnvelope('{ not json'),
    (error) =>
      error instanceof IngestValidationError &&
      error.issues.some((entry) => entry.code === 'invalid_json'),
  );
});

test('counts source and recordId by Unicode code point', async () => {
  const envelope = await parseEnvelope(
    await fixture('valid', 'safe-integer-unicode-boundaries.json'),
  );
  assert.equal(Array.from(envelope.source).length, 200);
  assert.equal(Array.from(envelope.records[0].recordId).length, 512);
});

test('accepts mathematically integral JSON number timestamps', async () => {
  const envelope = await parseEnvelope(
    await fixture('valid', 'integral-number-timestamps.json'),
  );
  assert.equal(envelope.records[0].payload.updatedAt, 1);
  assert.equal(envelope.records[0].payload.createdAt, 1000);
});

test('rejects unsafe integer timestamps instead of rounding them', async () => {
  await assert.rejects(
    parseEnvelope(await fixture('invalid', 'unsafe-integer-timestamp.json')),
    IngestValidationError,
  );
});

test('Standard Schema providers are additional veto gates', async () => {
  const provider = standardSchemaProvider({
    '~standard': {
      version: 1,
      vendor: 'fixture-provider',
      validate: () => ({ issues: [{ message: 'blocked by policy', path: ['records', 0] }] }),
    },
  });
  await assert.rejects(
    parseEnvelope(await fixture('valid', 'optional-fields-omitted.json'), {
      validationProviders: [provider],
    }),
    (error) =>
      error instanceof IngestValidationError &&
      error.issues.some((entry) => entry.provider === 'fixture-provider'),
  );
});

test('Ajv-compatible adapters preserve JSON Pointer paths', async () => {
  const validate = () => false;
  Object.defineProperty(validate, 'errors', {
    value: [{ instancePath: '/records/0/table', keyword: 'pattern', message: 'bad table' }],
  });
  const provider = ajvProvider(validate);
  await assert.rejects(
    parseEnvelope(await fixture('valid', 'optional-fields-omitted.json'), {
      validationProviders: [provider],
    }),
    (error) =>
      error instanceof IngestValidationError &&
      error.issues.some((entry) => entry.path.join('.') === 'records.0.table'),
  );
});

test('provider audit detects acceptance drift without changing canonical parsing', async () => {
  const acceptsEverything = callbackProvider('accept-all', () => []);
  const result = await auditEnvelopeProvider(
    await fixture('invalid', 'null-operation.json'),
    acceptsEverything,
  );
  assert.equal(result.canonicalAccepted, false);
  assert.equal(result.providerAccepted, true);
  assert.equal(result.drift, true);
});

test('a provider cannot reject silently with an empty issue list', async () => {
  const silentReject = {
    name: 'silent-reject',
    validate: () => ({ success: false, issues: [] }),
  };
  await assert.rejects(
    parseEnvelope(await fixture('valid', 'optional-fields-omitted.json'), {
      validationProviders: [silentReject],
    }),
    (error) =>
      error instanceof IngestValidationError &&
      error.issues.some((entry) => entry.code === 'provider_rejected'),
  );
});

test('arbitrary provider failures are normalized during parse and audit', async () => {
  const provider = {
    name: 'throwing-provider',
    validate() {
      throw new Error('boom');
    },
  };
  const text = await fixture('valid', 'optional-fields-omitted.json');
  await assert.rejects(
    parseEnvelope(text, { validationProviders: [provider] }),
    (error) =>
      error instanceof IngestValidationError &&
      error.issues.some(
        (entry) => entry.provider === 'throwing-provider' && entry.code === 'provider_exception',
      ),
  );
  const audit = await auditEnvelopeProvider(text, provider);
  assert.equal(audit.providerAccepted, false);
  assert.equal(audit.drift, true);
  assert.equal(audit.providerIssues[0].code, 'provider_exception');
});
