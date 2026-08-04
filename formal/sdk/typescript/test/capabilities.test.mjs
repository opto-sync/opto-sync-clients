import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STREAM_ADAPTER_PROTOCOL,
  STREAM_ADAPTER_PROTOCOL_VERSION,
  allCanonicalCapabilitySequencesV1,
  canonicalizeCapabilitySetV1,
  capabilityArrayJsonV1,
  capabilityRegistryV1,
  requiredCapabilitiesV1,
  validateCapabilitySequenceV1,
} from '../dist/capabilities.js';

const fixture = JSON.parse(
  await readFile(
    new URL('../../../protocol-fixtures/stream/capabilities.v1.json', import.meta.url),
    'utf8',
  ),
);

function expectedSequences() {
  const required = new Set(fixture.required);
  const optional = fixture.registry.filter((value) => !required.has(value));
  const sequences = [];
  for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
    const selected = new Set(fixture.required);
    optional.forEach((value, index) => {
      if (Math.floor(mask / 2 ** index) % 2 === 1) selected.add(value);
    });
    sequences.push(fixture.registry.filter((value) => selected.has(value)));
  }
  return sequences;
}

test('registry and required capabilities match the shared fixture', () => {
  assert.equal(STREAM_ADAPTER_PROTOCOL, fixture.protocol);
  assert.equal(STREAM_ADAPTER_PROTOCOL_VERSION, fixture.protocolVersion);
  assert.equal(fixture.wireRule, 'strict-subsequence');
  assert.deepEqual(capabilityRegistryV1(), fixture.registry);
  assert.deepEqual(requiredCapabilitiesV1(), fixture.required);
});

test('registry accessors return defensive copies', () => {
  const registry = capabilityRegistryV1();
  registry[0] = 'tampered';
  assert.deepEqual(capabilityRegistryV1(), fixture.registry);

  const required = requiredCapabilitiesV1();
  required[0] = 'tampered';
  assert.deepEqual(requiredCapabilitiesV1(), fixture.required);
});

test('all 16 canonical subsets normalize and round-trip exact array bytes', () => {
  const expected = expectedSequences();
  const actual = allCanonicalCapabilitySequencesV1();
  assert.equal(expected.length, 16);
  assert.equal(new Set(expected.map(JSON.stringify)).size, 16);
  assert.deepEqual(actual, expected);

  for (const sequence of expected) {
    const unordered = [...sequence].reverse();
    assert.deepEqual(canonicalizeCapabilitySetV1(unordered), sequence);
    assert.deepEqual(validateCapabilitySequenceV1(sequence), sequence);
    assert.equal(capabilityArrayJsonV1(sequence), JSON.stringify(sequence));
  }
});

test('every malformed capability class is rejected', () => {
  assert.throws(
    () =>
      canonicalizeCapabilitySetV1([
        'reset',
        'apply',
        'observe',
        'observe',
        'close',
      ]),
    /duplicate/u,
  );
  assert.throws(
    () => canonicalizeCapabilitySetV1(['reset', 'observe', 'close']),
    /missing required/u,
  );
  assert.throws(
    () =>
      canonicalizeCapabilitySetV1([
        'reset',
        'apply',
        'observe',
        'hello',
        'close',
      ]),
    /invalid capability/u,
  );
  assert.throws(
    () =>
      canonicalizeCapabilitySetV1([
        'reset',
        'apply',
        'observe',
        'teleport',
        'close',
      ]),
    /invalid capability/u,
  );
  assert.throws(
    () =>
      validateCapabilitySequenceV1([
        'reset',
        'apply',
        'observe',
        'snapshot',
        'settle',
        'close',
      ]),
    /canonical v1 order/u,
  );
});
