#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(sdkDir, '../..');
const artifactDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, '.formal-artifacts', 'capabilities');
const fixture = JSON.parse(
  readFileSync(
    path.join(root, 'formal', 'protocol-fixtures', 'stream', 'capabilities.v1.json'),
    'utf8',
  ),
);

const failures = [];

function parseReport(language) {
  const reportPath = path.join(artifactDir, `${language}.txt`);
  const fields = new Map();
  const sequences = [];
  for (const [index, line] of readFileSync(reportPath, 'utf8')
    .split(/\r?\n/u)
    .entries()) {
    if (line.length === 0) continue;
    const separator = line.indexOf('\t');
    if (separator <= 0) {
      failures.push(`${language}:${index + 1}: report line has no tab separator`);
      continue;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'sequence') {
      sequences.push(value);
      continue;
    }
    if (fields.has(key)) {
      failures.push(`${language}:${index + 1}: duplicate report field ${key}`);
      continue;
    }
    fields.set(key, value);
  }
  return { fields, sequences };
}

function expectedSequences() {
  const required = new Set(fixture.required);
  const optional = fixture.registry.filter((value) => !required.has(value));
  const sequences = [];
  for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
    const selected = new Set(fixture.required);
    optional.forEach((value, index) => {
      if (Math.floor(mask / 2 ** index) % 2 === 1) selected.add(value);
    });
    sequences.push(
      JSON.stringify(fixture.registry.filter((value) => selected.has(value))),
    );
  }
  return sequences;
}

function compareSet(language, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actual.length !== actualSet.size) {
    failures.push(`${language}: report contains duplicate capability arrays`);
  }
  const missing = [...expectedSet].filter((value) => !actualSet.has(value));
  const unexpected = [...actualSet].filter((value) => !expectedSet.has(value));
  if (missing.length > 0) {
    failures.push(`${language}: missing arrays: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    failures.push(`${language}: unexpected arrays: ${unexpected.join(', ')}`);
  }
}

const expected = expectedSequences();
if (expected.length !== 16 || new Set(expected).size !== 16) {
  failures.push('shared registry must derive exactly 16 unique capability arrays');
}

const reports = new Map();
for (const language of ['typescript', 'dart', 'gleam']) {
  const report = parseReport(language);
  reports.set(language, report);

  const expectedFields = new Map([
    ['protocol', fixture.protocol],
    ['protocolVersion', String(fixture.protocolVersion)],
    ['registry', JSON.stringify(fixture.registry)],
    ['required', JSON.stringify(fixture.required)],
  ]);
  for (const [key, value] of expectedFields) {
    if (report.fields.get(key) !== value) {
      failures.push(
        `${language}: ${key} drift: got ${JSON.stringify(report.fields.get(key))}; expected ${JSON.stringify(value)}`,
      );
    }
  }
  const unexpectedFields = [...report.fields.keys()].filter(
    (key) => !expectedFields.has(key),
  );
  if (unexpectedFields.length > 0) {
    failures.push(
      `${language}: unexpected report fields: ${unexpectedFields.join(', ')}`,
    );
  }

  for (const [index, encoded] of report.sequences.entries()) {
    try {
      const value = JSON.parse(encoded);
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        failures.push(`${language}: sequence ${index + 1} is not a string array`);
      }
      if (JSON.stringify(value) !== encoded) {
        failures.push(
          `${language}: sequence ${index + 1} is not compact canonical JSON: ${encoded}`,
        );
      }
    } catch (error) {
      failures.push(
        `${language}: sequence ${index + 1} is invalid JSON: ${error.message}`,
      );
    }
  }
  compareSet(language, report.sequences, expected);
}

const reference = reports.get('typescript')?.sequences ?? [];
for (const language of ['dart', 'gleam']) {
  compareSet(
    `${language} versus TypeScript`,
    reports.get(language)?.sequences ?? [],
    reference,
  );
}

if (failures.length > 0) {
  console.error('polyglot capability conformance failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  'TypeScript, Dart, and Gleam agree with the shared registry and all 16 exact capability-array encodings',
);
