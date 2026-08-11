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
const valuesSchema = readJson(contract.valuesSchema.path);
const telemetrySchema = readJson(contract.telemetry.eventSchema.path);
const failures = [];

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate(value) {
    const instant = new Date(value);
    return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
  },
});
for (const schema of [envelopeSchema, telemetrySchema, valuesSchema]) {
  try {
    ajv.addSchema(schema);
  } catch (error) {
    failures.push(`referenced SDK schema does not compile: ${error.message}`);
  }
}
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

if (valuesSchema.$id !== contract.valuesSchema.id) {
  failures.push(
    `SDK values schema id drift: manifest has ${contract.valuesSchema.id}, document has ${valuesSchema.$id}`,
  );
}

if (telemetrySchema.$id !== contract.telemetry.eventSchema.id) {
  failures.push(
    `telemetry schema id drift: manifest has ${contract.telemetry.eventSchema.id}, document has ${telemetrySchema.$id}`,
  );
} else {
  let validateTelemetry;
  try {
    validateTelemetry = ajv.getSchema(telemetrySchema.$id);
    if (!validateTelemetry) throw new Error('registered telemetry validator is unavailable');
  } catch (error) {
    failures.push(`telemetry event schema does not compile: ${error.message}`);
  }
  if (validateTelemetry) {
    const safe = {
      body: 'opto-sync state changed',
      severityText: 'INFO',
      severityNumber: 9,
      timestamp: '2026-08-11T17:53:28.151Z',
      attributes: {
        'service.name': 'opto-sync',
        'event.name': 'opto.sync.state.changed',
        'opto.sync.schema': 'opto-sync.telemetry/v1',
        'opto.sync.runtime': 'typescript',
        'opto.sync.status': 'idle',
        'opto.sync.consecutive_failures': 0,
      },
    };
    if (!validateTelemetry(safe)) {
      failures.push('telemetry event schema rejects the canonical safe event');
    }
    const withPayload = { ...safe, attributes: { ...safe.attributes, payload: 'private' } };
    if (validateTelemetry(withPayload)) {
      failures.push('telemetry event schema permits a mutation payload');
    }
    const withToken = { ...safe, attributes: { ...safe.attributes, token: 'secret' } };
    if (validateTelemetry(withToken)) {
      failures.push('telemetry event schema permits an authentication token');
    }
    const invalidAttributes = [
      ['checkpoint', { checkpoint: 'private-high-cardinality-value' }],
      ['record identifier', { recordId: 'customer-42' }],
      ['raw error message', { 'error.message': 'credential-bearing failure' }],
      ['negative counter', { 'opto.sync.pulled_changes': -1 }],
    ];
    for (const [description, attributes] of invalidAttributes) {
      if (validateTelemetry({ ...safe, attributes: { ...safe.attributes, ...attributes } })) {
        failures.push(`telemetry event schema permits ${description}`);
      }
    }
  }
}

const canonicalMergeOptionsSchema = {
  repository: 'opto-sync/syncer.rs',
  commit: 'bb71ac1b4b7d94dd7035e6cc7b76e5c10f284e98',
  path: 'schema/merge-options.schema.json',
  id: 'https://opto-sync.dev/schema/merge-options.schema.json',
  sha256: 'e9107667cee2868a922a70c9c48175c62b466fa728466c23bac766aebcbb2f2a',
  status: 'canonical',
};
for (const [field, expected] of Object.entries(canonicalMergeOptionsSchema)) {
  if (contract.mergeOptionsSchema[field] !== expected) {
    failures.push(
      `merge-options schema ${field} drift: expected ${expected}, got ${contract.mergeOptionsSchema[field]}`,
    );
  }
}
const expectedMergeOptionBlockers = new Set();
if (
  contract.mergeOptionsSchema.blockers.length !== expectedMergeOptionBlockers.size ||
  contract.mergeOptionsSchema.blockers.some(
    (blocker) => !expectedMergeOptionBlockers.has(blocker),
  )
) {
  failures.push('canonical merge-options schema still reports a blocker');
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
  'createProtocolSyncTelemetryRecord',
  'emitProtocolSyncTelemetry',
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
for (const unknown of operationIds.filter((operation) => !requiredOperations.has(operation))) {
  failures.push(`unknown operation is outside the v1 contract: ${unknown}`);
}

const expectedPortable = new Set([
  'formatHlc',
  'parseHlc',
  'compareHlc',
  'parseEnvelope',
  'createProtocolSyncTelemetryRecord',
  'emitProtocolSyncTelemetry',
]);
for (const operation of contract.operations) {
  const expected = expectedPortable.has(operation.id) ? 'portable' : 'candidate';
  if (operation.conformance !== expected) {
    failures.push(
      `${operation.id}: expected ${expected} conformance, got ${operation.conformance}`,
    );
  }
  const refs =
    operation.normalized.kind === 'call'
      ? [operation.normalized.requestSchemaRef, operation.normalized.resultSchemaRef]
      : [operation.normalized.contractSchemaRef];
  for (const ref of refs) {
    if (!ajv.getSchema(ref)) {
      failures.push(`${operation.id}: normalized schema reference does not resolve: ${ref}`);
    }
  }
}

const normalizedCases = [
  [
    'formatHlc request',
    `${valuesSchema.$id}#/$defs/FormatHlcRequest`,
    { millis: 1721822400000, counter: 255, nodeId: '9f3a2b' },
  ],
  [
    'compareHlc result',
    `${valuesSchema.$id}#/$defs/OrderingSign`,
    -1,
  ],
  [
    'telemetry input',
    `${valuesSchema.$id}#/$defs/TelemetryInput`,
    {
      runtime: 'typescript',
      kind: 'state.changed',
      status: 'idle',
      timestamp: '2026-08-11T17:53:28.151Z',
    },
  ],
];
for (const [label, ref, value] of normalizedCases) {
  const validator = ajv.getSchema(ref);
  if (!validator || !validator(value)) {
    failures.push(`${label} is rejected by ${ref}`);
  }
}
const invalidHlcParts = [
  { millis: -1, counter: 0, nodeId: 'node' },
  { millis: 10000000000000, counter: 0, nodeId: 'node' },
  { millis: 1721822400000, counter: 65536, nodeId: 'node' },
  { millis: 1721822400000, counter: 0, nodeId: 'has-dash' },
];
const validateHlcParts = ajv.getSchema(`${valuesSchema.$id}#/$defs/HlcParts`);
for (const value of invalidHlcParts) {
  if (validateHlcParts?.(value)) {
    failures.push(`normalized HLC schema accepts noncanonical parts: ${JSON.stringify(value)}`);
  }
}

const languageRoots = {
  rust: 'clients/rust/',
  dart: 'clients/dart/',
  typescript: 'clients/ts/',
};

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
}

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
    if (!withoutComments(source).includes(binding.declaration)) {
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
const zedLock = readFileSync(path.join(root, '.zpkg.lock'), 'utf8');
for (const dependency of Object.values(contract.dependencies)) {
  const declaration = `"${dependency.coordinate}" = "${dependency.version}"`;
  if (dependency.status === 'available') {
    if (!zedManifest.includes(declaration)) {
      failures.push(`.zpkg.toml is missing available dependency ${declaration}`);
    }
    if (!zedLock.includes(dependency.coordinate)) {
      failures.push(`.zpkg.lock is missing available dependency ${dependency.coordinate}`);
    }
  } else {
    if (zedManifest.includes(declaration)) {
      failures.push(`.zpkg.toml prematurely declares pending dependency ${declaration}`);
    }
    if (zedLock.includes(dependency.coordinate)) {
      failures.push(`.zpkg.lock prematurely resolves pending dependency ${dependency.coordinate}`);
    }
  }
}
if (/^[ \t]*["']?opto-sync\/syncer(?:\.c)?["']?[ \t]*=/mu.test(zedManifest)) {
  failures.push('syncer.c is bundled by gitlink and must not also be a Zed dependency');
}

const sdkMatrix = readFileSync(path.join(root, 'clients/sdk-matrix.toml'), 'utf8');
const expectedMatrixEntries = [
  `canonical_api_contract = "../schema/opto-sync-sdk-api.v1.json"`,
  `merge_options_schema_id = "${contract.mergeOptionsSchema.id}"`,
  `merge_options_schema_status = "${contract.mergeOptionsSchema.status}"`,
  `cross_org_interfaces_package = "${contract.dependencies.sharedInterfaces.coordinate}"`,
  `structured_logging_package = "${contract.dependencies.structuredLogging.coordinate}"`,
  `structured_logging_mode = "${contract.telemetry.mode}"`,
  `ores_zed_dependency_status = "pending-release"`,
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
  `SDK API contract binds ${contract.operations.length} capabilities across Rust, Dart, and TypeScript; ${expectedPortable.size} are portable and the remainder carry explicit candidate differences`,
);
