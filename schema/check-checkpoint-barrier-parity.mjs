#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const schemaPath = new URL('./opto-sync-checkpoint-barrier.v1.schema.json', import.meta.url);
const typeSpecPath = new URL('../contract/checkpoint-barrier.v1.tsp', import.meta.url);
const vectorsPath = new URL('../formal/checkpoint_barrier_vectors.v1.json', import.meta.url);

const [schemaText, typeSpec, vectorsText] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(typeSpecPath, 'utf8'),
  readFile(vectorsPath, 'utf8'),
]);
const schema = JSON.parse(schemaText);
const vectors = JSON.parse(vectorsText);

const fail = (message) => {
  console.error(`checkpoint-barrier parity: ${message}`);
  process.exitCode = 1;
};

const canonicalCheckpoint = /^(?:0|[1-9]\d*)$/;
const expectedTargetFields = ['protocolVersion', 'checkpoint', 'generation'];
const expectedResultFields = [
  'targetCheckpoint',
  'checkpoint',
  'generation',
  'elapsedMs',
  'cycles',
  'alreadyCaughtUp',
];
const expectedCodes = vectors.terminalCodes;

function typeSpecModelFields(modelName) {
  const model = typeSpec.match(new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\}`));
  if (!model) return [];
  return [...model[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\??\s*:/gm)].map((match) => match[1]);
}

function typeSpecEnumMembers(enumName) {
  const body = typeSpec.match(new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`));
  if (!body) return [];
  return body[1]
    .split(/[\n,]/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

function sameMembers(label, left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(`${label} mismatch: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
}

const schemaTarget = schema.$defs?.authoritativeCheckpointTarget;
const schemaResult = schema.$defs?.caughtUpResult;
const schemaCodes = schema.$defs?.caughtUpBarrierErrorCode?.enum;
if (!schemaTarget || !schemaResult || !Array.isArray(schemaCodes)) {
  fail('JSON Schema is missing required checkpoint barrier definitions');
} else {
  sameMembers('target fields', Object.keys(schemaTarget.properties ?? {}), expectedTargetFields);
  sameMembers('result fields', Object.keys(schemaResult.properties ?? {}), expectedResultFields);
  sameMembers('terminal codes', schemaCodes, expectedCodes);
}

sameMembers(
  'TypeSpec target fields',
  typeSpecModelFields('AuthoritativeCheckpointTarget'),
  expectedTargetFields,
);
sameMembers('TypeSpec result fields', typeSpecModelFields('CaughtUpResult'), expectedResultFields);
sameMembers(
  'TypeSpec terminal codes',
  typeSpecEnumMembers('CaughtUpBarrierErrorCode'),
  expectedCodes,
);

if (!typeSpec.includes('@pattern("^(?:0|[1-9]\\\\d*)$")')) {
  fail('TypeSpec Checkpoint scalar does not carry the canonical-decimal pattern');
}
if (schema.$defs?.checkpoint?.pattern !== '^(?:0|[1-9]\\d*)$') {
  fail('JSON Schema checkpoint pattern is not canonical unsigned decimal');
}

for (const vector of vectors.checkpointComparisons ?? []) {
  if (!canonicalCheckpoint.test(vector.local) || !canonicalCheckpoint.test(vector.target)) {
    fail(`comparison vector contains a non-canonical checkpoint: ${JSON.stringify(vector)}`);
    continue;
  }
  const reached =
    vector.local.length !== vector.target.length
      ? vector.local.length > vector.target.length
      : vector.local >= vector.target;
  if (reached !== vector.reached) {
    fail(`comparison vector has incorrect expected result: ${JSON.stringify(vector)}`);
  }
}
for (const value of vectors.invalidCheckpoints ?? []) {
  if (canonicalCheckpoint.test(value)) {
    fail(`invalid checkpoint vector is actually canonical: ${JSON.stringify(value)}`);
  }
}

if (!process.exitCode) {
  console.log(
    `checkpoint-barrier parity OK: ${expectedCodes.length} terminal codes, ` +
      `${expectedTargetFields.length} target fields, ${expectedResultFields.length} result fields, ` +
      `${vectors.checkpointComparisons.length} comparison vectors`,
  );
}
