#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(schemaDir, '..');
const streamDir = path.join(root, 'formal', 'protocol-fixtures', 'stream');
const schema = JSON.parse(
  readFileSync(
    path.join(root, 'formal', 'adapter-stream-protocol.schema.json'),
    'utf8',
  ),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
let validate;
try {
  validate = ajv.compile(schema);
} catch (error) {
  console.error(`formal stream schema does not compile: ${error.message}`);
  process.exit(1);
}

const failures = [];
function readLines(relative) {
  return readFileSync(path.join(streamDir, relative), 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        failures.push(`${relative}:${index + 1}: invalid JSON: ${error.message}`);
        return null;
      }
    })
    .filter((value) => value !== null);
}

for (const relative of [
  'valid/happy.jsonl',
  'valid/unsupported.jsonl',
  'valid/minimal-capabilities.jsonl',
]) {
  for (const [index, value] of readLines(relative).entries()) {
    if (validate(value)) continue;
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '<root>'} ${error.message}`)
      .join('; ');
    failures.push(`${relative}:${index + 1}: schema rejected valid message: ${detail}`);
  }
}

for (const relative of [
  'invalid/duplicate-capability.jsonl',
  'invalid/missing-required-capability.jsonl',
  'invalid/hello-capability.jsonl',
  'invalid/unknown-capability.jsonl',
  'invalid/out-of-order-capability.jsonl',
]) {
  const lines = readLines(relative);
  const results = lines.map((value) => validate(value));
  if (results.length !== 2) {
    failures.push(`${relative}: expected one request and one response`);
    continue;
  }
  if (!results[0]) {
    failures.push(`${relative}: setup hello request must remain schema-valid`);
  }
  if (results[1]) {
    failures.push(`${relative}: schema accepted the malformed hello response`);
  }
}

if (failures.length > 0) {
  console.error('formal stream schema/corpus disagreement:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('formal stream schema agrees with canonical capability fixtures');
