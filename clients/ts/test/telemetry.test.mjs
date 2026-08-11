import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emitProtocolSyncTelemetry,
  emitTelemetry,
} from '../dist/telemetry.js';

const stateInput = Object.freeze({
  runtime: 'typescript',
  kind: 'state.changed',
  status: 'idle',
  consecutiveFailures: 0,
  timestamp: '2026-08-11T17:53:28.151Z',
  requestId: 'sync-cycle-42',
});

test('a rejecting telemetry sink is contained', async () => {
  let calls = 0;
  await emitProtocolSyncTelemetry(async () => {
    calls += 1;
    throw new Error('logger unavailable');
  }, stateInput);
  assert.equal(calls, 1);
});

test('invalid metadata is rejected before the sink boundary', async () => {
  let calls = 0;
  await emitProtocolSyncTelemetry(() => {
    calls += 1;
  }, {
    ...stateInput,
    requestId: 'bad/id',
  });
  assert.equal(calls, 0);
});

test('the sink receives only a frozen canonical ORE record', async () => {
  let received;
  await emitTelemetry((record) => {
    received = record;
  }, {
    ...stateInput,
    payload: { private: true },
    checkpoint: 'private-high-cardinality-value',
  });

  assert.equal(Object.isFrozen(received), true);
  assert.equal(Object.isFrozen(received.attributes), true);
  assert.equal(received.attributes['opto.sync.schema'], 'opto-sync.telemetry/v1');
  assert.equal('payload' in received, false);
  assert.equal('checkpoint' in received, false);
  assert.equal('payload' in received.attributes, false);
  assert.equal('checkpoint' in received.attributes, false);
});
