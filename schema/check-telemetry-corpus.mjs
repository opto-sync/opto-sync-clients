#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(path.join(schemaDir, 'opto-sync-telemetry.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate(value) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
      0,
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month];
  },
});
let validate;
try {
  validate = ajv.compile(schema);
} catch (error) {
  console.error(`telemetry schema does not compile: ${error.message}`);
  process.exit(1);
}

const failures = [];
for (const kind of ['valid', 'invalid']) {
  const directory = path.join(schemaDir, 'telemetry-fixtures', kind);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    failures.push(`${kind}/ has no telemetry fixtures`);
    continue;
  }
  for (const file of files) {
    const record = JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
    const accepted = validate(record);
    if (accepted === (kind === 'valid')) continue;
    const detail = accepted
      ? 'schema accepted a fixture the corpus marks invalid'
      : (validate.errors ?? [])
          .map((error) => `${error.instancePath || '<root>'} ${error.message}`)
          .join('; ');
    failures.push(`${kind}/${file}: ${detail}`);
  }
}

if (failures.length > 0) {
  console.error('telemetry schema/corpus disagreement:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('telemetry schema agrees with every privacy-bounded fixture');
