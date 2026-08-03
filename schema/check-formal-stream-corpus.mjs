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
const registryContract = JSON.parse(
  readFileSync(path.join(streamDir, 'capabilities.v1.json'), 'utf8'),
);

const failures = [];

function stableKey(value) {
  return JSON.stringify(value);
}

function equalSequence(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function requireUniqueStringArray(value, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} must be an array`);
    return [];
  }
  const strings = value.filter(
    (entry) => typeof entry === 'string' && entry.length > 0,
  );
  if (strings.length !== value.length) {
    failures.push(`${label} must contain only nonempty strings`);
  }
  const duplicates = strings.filter(
    (entry, index) => strings.indexOf(entry) !== index,
  );
  if (duplicates.length > 0) {
    failures.push(
      `${label} contains duplicates: ${[...new Set(duplicates)].join(', ')}`,
    );
  }
  return strings;
}

function formatErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '<root>'} ${error.message}`)
    .join('; ');
}

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

const ajv = new Ajv2020({ allErrors: true, strict: true });
let validate;
try {
  validate = ajv.compile(schema);
} catch (error) {
  console.error(`formal stream schema does not compile: ${error.message}`);
  process.exit(1);
}

let expectedCapabilityCount = 0;

function checkRegistryContract() {
  if (registryContract.protocol !== 'fm.adapter.stream.v1') {
    failures.push(
      `capability registry protocol must be fm.adapter.stream.v1, got ${stableKey(registryContract.protocol)}`,
    );
  }
  if (registryContract.protocolVersion !== 1) {
    failures.push(
      `capability registry protocolVersion must be 1, got ${stableKey(registryContract.protocolVersion)}`,
    );
  }
  if (registryContract.wireRule !== 'strict-subsequence') {
    failures.push(
      `capability registry wireRule must be strict-subsequence, got ${stableKey(registryContract.wireRule)}`,
    );
  }

  const registry = requireUniqueStringArray(
    registryContract.registry,
    'capability registry',
  );
  const required = requireUniqueStringArray(
    registryContract.required,
    'required capability set',
  );
  if (registry.includes('hello')) {
    failures.push('capability registry must not advertise hello');
  }

  const registrySet = new Set(registry);
  const unknownRequired = required.filter(
    (capability) => !registrySet.has(capability),
  );
  if (unknownRequired.length > 0) {
    failures.push(
      `required capabilities are absent from the registry: ${unknownRequired.join(', ')}`,
    );
  }
  const requiredInRegistryOrder = registry.filter((capability) =>
    required.includes(capability),
  );
  if (!equalSequence(required, requiredInRegistryOrder)) {
    failures.push(
      `required capabilities are not in registry order: got ${stableKey(required)}; expected ${stableKey(requiredInRegistryOrder)}`,
    );
  }

  const operationNames = schema.$defs?.operationName?.enum;
  const expectedOperationNames = ['hello', ...registry];
  if (!equalSequence(operationNames, expectedOperationNames)) {
    failures.push(
      `schema operationName enum drift: got ${stableKey(operationNames)}; expected ${stableKey(expectedOperationNames)}`,
    );
  }

  const optional = registry.filter(
    (capability) => !required.includes(capability),
  );
  if (optional.length > 20) {
    failures.push(
      `refusing to enumerate ${optional.length} optional capabilities; split or version the registry`,
    );
    return;
  }

  const expected = [];
  const combinations = 2 ** optional.length;
  for (let mask = 0; mask < combinations; mask += 1) {
    const selected = new Set(required);
    optional.forEach((capability, index) => {
      if (Math.floor(mask / 2 ** index) % 2 === 1) {
        selected.add(capability);
      }
    });
    expected.push(registry.filter((capability) => selected.has(capability)));
  }
  expectedCapabilityCount = expected.length;

  const actual = schema.$defs?.canonicalCapabilitiesV1?.enum;
  if (!Array.isArray(actual)) {
    failures.push('schema canonicalCapabilitiesV1.enum must be an array');
  } else {
    const actualKeys = actual.map(stableKey);
    const duplicateKeys = actualKeys.filter(
      (entry, index) => actualKeys.indexOf(entry) !== index,
    );
    if (duplicateKeys.length > 0) {
      failures.push(
        `schema canonicalCapabilitiesV1.enum contains duplicate arrays: ${[...new Set(duplicateKeys)].join(', ')}`,
      );
    }

    const expectedKeys = new Set(expected.map(stableKey));
    const actualKeySet = new Set(actualKeys);
    const missing = [...expectedKeys].filter((entry) => !actualKeySet.has(entry));
    const unexpected = [...actualKeySet].filter(
      (entry) => !expectedKeys.has(entry),
    );
    if (missing.length > 0) {
      failures.push(
        `schema canonicalCapabilitiesV1.enum is missing: ${missing.join(', ')}`,
      );
    }
    if (unexpected.length > 0) {
      failures.push(
        `schema canonicalCapabilitiesV1.enum has unexpected arrays: ${unexpected.join(', ')}`,
      );
    }
  }

  for (const [index, capabilities] of expected.entries()) {
    const message = {
      kind: 'response',
      message: {
        protocol: registryContract.protocol,
        protocolVersion: registryContract.protocolVersion,
        requestId: String(index + 1),
        machine: 'registry-conformance',
        generation: 0,
        operation: 'hello',
        outcome: {
          kind: 'ok',
          value: {
            implementation: {
              language: 'javascript',
              name: 'schema-registry-check',
              version: '1',
            },
            capabilities,
            canonicalStateSchemaHash: `sha256:${'0'.repeat(64)}`,
          },
        },
      },
    };
    if (!validate(message)) {
      failures.push(
        `schema rejected generated canonical capability set ${stableKey(capabilities)}: ${formatErrors(validate.errors)}`,
      );
    }
  }
}

checkRegistryContract();

for (const relative of [
  'valid/happy.jsonl',
  'valid/unsupported.jsonl',
  'valid/minimal-capabilities.jsonl',
]) {
  for (const [index, value] of readLines(relative).entries()) {
    if (validate(value)) continue;
    failures.push(
      `${relative}:${index + 1}: schema rejected valid message: ${formatErrors(validate.errors)}`,
    );
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
  console.error('formal stream schema/registry/corpus disagreement:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `formal stream schema, registry, and fixture corpus agree (${expectedCapabilityCount} canonical capability sets)`,
);
