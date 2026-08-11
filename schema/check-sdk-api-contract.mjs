#!/usr/bin/env node

import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(schemaDir, '..');

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
}

const metaSchema = readJson('schema/opto-sync-sdk-api.schema.json');
const contract = readJson('schema/opto-sync-sdk-api.v1.json');
const envelopeSchema = readJson(contract.envelopeSchema.path);
const telemetrySchema = readJson(contract.telemetry.eventSchema.path);
const failures = [];

const ajv = new Ajv2020({ allErrors: true, strict: true });
let validate;
try {
  validate = ajv.compile(metaSchema);
} catch (error) {
  console.error(`SDK API schema does not compile: ${error.message}`);
  process.exit(1);
}

if (!validate(contract)) {
  failures.push(
    `SDK API manifest violates its JSON Schema: ${(validate.errors ?? [])
      .map((error) => `${error.instancePath || '<root>'} ${error.message}`)
      .join('; ')}`,
  );
}

if (envelopeSchema.$id !== contract.envelopeSchema.id) {
  failures.push(
    `envelope schema id drift: manifest has ${contract.envelopeSchema.id}, document has ${envelopeSchema.$id}`,
  );
}

if (telemetrySchema.$id !== contract.telemetry.eventSchema.id) {
  failures.push(
    `telemetry schema id drift: manifest has ${contract.telemetry.eventSchema.id}, document has ${telemetrySchema.$id}`,
  );
} else {
  let validateTelemetry;
  try {
    validateTelemetry = ajv.compile(telemetrySchema);
  } catch (error) {
    failures.push(`telemetry event schema does not compile: ${error.message}`);
  }
  if (validateTelemetry) {
    const safe = {
      schemaVersion: 1,
      name: 'opto_sync.sync.cycle_succeeded',
      level: 'info',
      fields: { checkpoint: '9', pushedMutations: 2 },
    };
    if (!validateTelemetry(safe)) {
      failures.push('telemetry event schema rejects the canonical safe event');
    }
    const withPayload = {
      ...safe,
      fields: { ...safe.fields, payload: { private: true } },
    };
    if (validateTelemetry(withPayload)) {
      failures.push('telemetry event schema permits a mutation payload');
    }
    const withToken = {
      ...safe,
      fields: { ...safe.fields, token: 'secret' },
    };
    if (validateTelemetry(withToken)) {
      failures.push('telemetry event schema permits an authentication token');
    }
    const invalidFields = [
      ['noncanonical checkpoint', { checkpoint: '09' }],
      ['unstable error code', { code: 'contains-sensitive-text' }],
      ['negative counter', { pulledChanges: -1 }],
    ];
    for (const [description, fields] of invalidFields) {
      if (validateTelemetry({ ...safe, fields })) {
        failures.push(`telemetry event schema permits ${description}`);
      }
    }
  }
}

const canonicalMergeOptionsSchema = {
  repository: 'opto-sync/syncer.rs',
  commit: '8ef3d4bb63738a90b1e3958500578aebb89ee8cc',
  path: 'schema/merge-options.schema.json',
  id: 'https://opto-sync.dev/schema/merge-options.schema.json',
  sha256: 'd5bd069eefc24293e3f8d8e666bdbd1d2461b59853f73c0cea7bb7c0424d7bd8',
};
for (const [field, expected] of Object.entries(canonicalMergeOptionsSchema)) {
  if (contract.mergeOptionsSchema[field] !== expected) {
    failures.push(
      `merge-options schema ${field} drift: expected ${expected}, got ${contract.mergeOptionsSchema[field]}`,
    );
  }
}

const requiredOperations = new Set([
  'queueUpsert',
  'queueDelete',
  'pendingMutations',
  'buildPushRequest',
  'acknowledgePush',
  'pullCheckpoint',
  'installSnapshot',
  'reconcileIncoming',
  'rebasePending',
  'formatHlc',
  'parseHlc',
  'compareHlc',
  'parseEnvelope',
  'auditEnvelopeProvider',
  'protocolSyncCycle',
  'webSocketTransport',
  'createTelemetryEvent',
  'emitTelemetry',
  'observeSyncCycle',
]);
const operationIds = contract.operations.map((operation) => operation.id);
for (const operation of requiredOperations) {
  if (!operationIds.includes(operation)) {
    failures.push(`portable operation is missing: ${operation}`);
  }
}
for (const duplicate of operationIds.filter(
  (operation, index) => operationIds.indexOf(operation) !== index,
)) {
  failures.push(`portable operation is declared more than once: ${duplicate}`);
}

const languageRoots = {
  rust: 'clients/rust/',
  dart: 'clients/dart/',
  typescript: 'clients/ts/',
};

for (const operation of contract.operations) {
  for (const [language, binding] of Object.entries(operation.bindings)) {
    if (!binding.source.startsWith(languageRoots[language])) {
      failures.push(
        `${operation.id}.${language}: ${binding.source} is outside ${languageRoots[language]}`,
      );
      continue;
    }
    const sourcePath = path.join(root, binding.source);
    let source;
    try {
      source = readFileSync(sourcePath, 'utf8');
    } catch (error) {
      failures.push(`${operation.id}.${language}: cannot read ${binding.source}: ${error.message}`);
      continue;
    }
    if (!binding.declaration.includes(binding.symbol)) {
      failures.push(
        `${operation.id}.${language}: declaration marker does not name ${binding.symbol}`,
      );
    }
    if (!source.includes(binding.declaration)) {
      failures.push(
        `${operation.id}.${language}: ${binding.declaration} is absent from ${binding.source}`,
      );
    }
    if (binding.owner) {
      const ownerMarkers =
        language === 'rust'
          ? [`pub struct ${binding.owner}`, `pub trait ${binding.owner}`, `impl ${binding.owner}`]
          : [`class ${binding.owner}`, `interface ${binding.owner}`];
      if (!ownerMarkers.some((marker) => source.includes(marker))) {
        failures.push(
          `${operation.id}.${language}: owner ${binding.owner} is absent from ${binding.source}`,
        );
      }
    }
  }
}

const zedManifest = readFileSync(path.join(root, '.zpkg.toml'), 'utf8');
for (const dependency of Object.values(contract.dependencies)) {
  const declaration = `"${dependency.coordinate}" = "${dependency.version}"`;
  if (!zedManifest.includes(declaration)) {
    failures.push(`.zpkg.toml is missing canonical dependency ${declaration}`);
  }
}
if (/^[ \t]*["']?opto-sync\/syncer(?:\.c)?["']?[ \t]*=/mu.test(zedManifest)) {
  failures.push('syncer.c is bundled by gitlink and must not also be a Zed dependency');
}

const sdkMatrix = readFileSync(path.join(root, 'clients/sdk-matrix.toml'), 'utf8');
const expectedMatrixEntries = [
  `canonical_api_contract = "../schema/opto-sync-sdk-api.v1.json"`,
  `merge_options_schema_id = "${contract.mergeOptionsSchema.id}"`,
  `cross_org_interfaces_package = "${contract.dependencies.sharedInterfaces.coordinate}"`,
  `structured_logging_package = "${contract.dependencies.structuredLogging.coordinate}"`,
  `structured_logging_mode = "${contract.telemetry.mode}"`,
];
for (const entry of expectedMatrixEntries) {
  if (!sdkMatrix.includes(entry)) {
    failures.push(`clients/sdk-matrix.toml is missing ${entry}`);
  }
}

if (failures.length > 0) {
  console.error('SDK API contract disagreement:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `SDK API contract binds ${contract.operations.length} portable operations across Rust, Dart, and TypeScript`,
);
