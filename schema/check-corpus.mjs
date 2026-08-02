#!/usr/bin/env node
// Evaluate the envelope schema itself against the shared fixture corpus.
//
// The per-language validators (TS zod, Dart, Rust, Gleam) are all hand-written
// from this document and each tests itself against these fixtures — but until
// this gate existed nothing ran a real JSON Schema evaluator over them, so the
// document could contradict the corpus it is supposed to define. It did: a
// delete record's payload was required to carry `updatedAt` (via the payload
// $ref) *and* to be empty (via the delete branch), which no delete record can
// satisfy, while `valid/nested-keyed-arrays.json` contains one.
//
// Usage: node schema/check-corpus.mjs
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(path.join(schemaDir, 'opto-sync-envelope.schema.json'), 'utf8'),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
let validate;
try {
  validate = ajv.compile(schema);
} catch (error) {
  console.error(`schema does not compile: ${error.message}`);
  process.exit(1);
}

const failures = [];
for (const kind of ['valid', 'invalid']) {
  const dir = path.join(schemaDir, 'fixtures', kind);
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  if (files.length === 0) {
    failures.push(`${kind}/ has no fixtures`);
    continue;
  }
  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    const accepted = validate(data);
    const expected = kind === 'valid';
    if (accepted === expected) continue;
    const detail = accepted
      ? 'schema accepted a fixture the corpus marks invalid'
      : `schema rejected a valid fixture: ${(validate.errors ?? [])
          .map((e) => `${e.instancePath || '<root>'} ${e.message}`)
          .join('; ')}`;
    failures.push(`${kind}/${file}: ${detail}`);
  }
}

if (failures.length > 0) {
  console.error('schema/corpus disagreement:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('schema agrees with every fixture in the shared corpus');
