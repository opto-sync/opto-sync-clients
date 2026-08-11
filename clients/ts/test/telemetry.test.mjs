import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTelemetryEvent,
  emitTelemetry,
  observeSyncCycle,
} from '../dist/telemetry.js';

const cycleResult = Object.freeze({
  pushedMutations: 2,
  acknowledgedMutations: 2,
  pulledChanges: 1,
  installedSnapshots: 0,
  checkpoint: '9',
  hasMorePending: false,
});

test('a rejecting telemetry sink cannot change a successful sync result', async () => {
  let calls = 0;
  const sink = async () => {
    calls += 1;
    throw new Error('logger unavailable');
  };

  const actual = await observeSyncCycle(sink, async () => cycleResult);
  assert.strictEqual(actual, cycleResult);
  assert.equal(calls, 2);
});

test('a rejecting telemetry sink cannot replace the original sync error', async () => {
  const original = new Error('authoritative failure');
  await assert.rejects(
    observeSyncCycle(
      async () => {
        throw new Error('logger unavailable');
      },
      async () => {
        throw original;
      },
    ),
    (error) => error === original,
  );
});

test('runtime callers cannot smuggle sensitive fields into an event', () => {
  const event = createTelemetryEvent(
    'opto_sync.sync.cycle_succeeded',
    'info',
    {
      checkpoint: '9',
      payload: { private: true },
      token: 'secret',
      request: { authorization: 'secret' },
      response: { record: { private: true } },
    },
  );
  assert.deepEqual(event.fields, { checkpoint: '9' });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.fields), true);
});

test('the final sink boundary sanitizes hand-written JavaScript events', async () => {
  let received;
  await emitTelemetry((event) => {
    received = event;
  }, {
    schemaVersion: 1,
    name: 'opto_sync.sync.cycle_succeeded',
    level: 'info',
    fields: {
      checkpoint: '9',
      payload: { private: true },
      token: 'secret',
    },
  });
  assert.deepEqual(received.fields, { checkpoint: '9' });
});

test('the event factory enforces canonical field constraints', () => {
  assert.throws(
    () => createTelemetryEvent(
      'opto_sync.sync.cycle_succeeded',
      'info',
      { checkpoint: '09' },
    ),
    TypeError,
  );
  assert.throws(
    () => createTelemetryEvent(
      'opto_sync.sync.cycle_failed',
      'error',
      { code: 'contains-sensitive-text' },
    ),
    TypeError,
  );
  assert.throws(
    () => createTelemetryEvent(
      'opto_sync.sync.cycle_succeeded',
      'info',
      { pulledChanges: -1 },
    ),
    TypeError,
  );
});

test('invalid result metadata cannot change the successful sync result', async () => {
  const resultWithInvalidCheckpoint = {
    ...cycleResult,
    checkpoint: '09',
  };
  let calls = 0;
  const actual = await observeSyncCycle(() => {
    calls += 1;
  }, async () => resultWithInvalidCheckpoint);
  assert.strictEqual(actual, resultWithInvalidCheckpoint);
  assert.equal(calls, 1);
});
