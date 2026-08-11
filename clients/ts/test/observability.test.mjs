import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createProtocolSyncTelemetryRecord,
  protocolSyncStateTelemetry,
} from '../dist/observability.js';
import * as browserEntry from '../dist/esm/browser.js';

const fixtureUrl = new URL(
  '../../../schema/telemetry-fixtures/valid/cycle-completed.json',
  import.meta.url,
);

test('cycle telemetry is byte-shape compatible with the shared ORE fixture', async () => {
  const expected = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const record = createProtocolSyncTelemetryRecord({
    runtime: 'typescript',
    kind: 'cycle.completed',
    status: 'idle',
    timestamp: '2026-08-11T17:53:28.151Z',
    requestId: 'sync-cycle-42',
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    traceFlags: 1,
    cycle: {
      pushedMutations: 3,
      acknowledgedMutations: 3,
      pulledChanges: 2,
      installedSnapshots: 0,
      checkpoint: 'private-high-cardinality-value',
      hasMorePending: false,
    },
  });
  assert.deepEqual(record, expected);
  assert.equal(JSON.stringify(record).includes('private-high-cardinality-value'), false);
});

test('state adapter emits bounded data and rejects raw exception text as a code', () => {
  const record = protocolSyncStateTelemetry(
    'typescript',
    {
      status: 'backoff',
      consecutiveFailures: 2,
      nextRetryAt: Date.parse('2026-08-11T17:53:30.151Z'),
      lastError: 'contains a URL, record id, or secret and must stay local',
    },
    {
      timestamp: '2026-08-11T17:53:28.151Z',
      errorCode: 'SYNC_TRANSPORT_ERROR',
    },
  );
  assert.equal(record.severityText, 'WARN');
  assert.equal(record.attributes['error.code'], 'SYNC_TRANSPORT_ERROR');
  assert.equal(JSON.stringify(record).includes('must stay local'), false);
  assert.throws(
    () =>
      createProtocolSyncTelemetryRecord({
        runtime: 'typescript',
        kind: 'cycle.failed',
        status: 'error',
        timestamp: '2026-08-11T17:53:28.151Z',
        errorCode: 'raw exception message is not a code',
      }),
    /machine code/,
  );
  assert.throws(
    () =>
      createProtocolSyncTelemetryRecord({
        runtime: 'typescript',
        kind: 'state.changed',
        status: 'idle',
        timestamp: '2026-08-11T17:53:28.151Z',
        requestId: 'short',
      }),
    /ores-interfaces identifier/,
  );
  for (const invalidInput of [
    { requestId: 12345678 },
    { traceState: 123 },
    {
      kind: 'cycle.completed',
      cycle: {
        pushedMutations: 0,
        acknowledgedMutations: 0,
        pulledChanges: 0,
        installedSnapshots: 0,
        checkpoint: null,
        hasMorePending: 'false',
      },
    },
  ]) {
    assert.throws(() =>
      createProtocolSyncTelemetryRecord({
        runtime: 'typescript',
        kind: 'state.changed',
        status: 'idle',
        timestamp: '2026-08-11T17:53:28.151Z',
        ...invalidInput,
      }),
    );
  }
  assert.doesNotThrow(() =>
    createProtocolSyncTelemetryRecord({
      runtime: 'typescript',
      kind: 'state.changed',
      status: 'idle',
      timestamp: '2026-08-11T17:53:28.151Z',
      traceState: '🥽'.repeat(512),
    }),
  );
  assert.throws(() =>
    createProtocolSyncTelemetryRecord({
      runtime: 'typescript',
      kind: 'state.changed',
      status: 'idle',
      timestamp: '2026-08-11T17:53:28.151Z',
      traceState: '🥽'.repeat(513),
    }),
  );
  assert.throws(
    () =>
      createProtocolSyncTelemetryRecord({
        runtime: 'typescript',
        kind: 'state.changed',
        status: 'idle',
        timestamp: '2026-08-11T17:53:28.151Z',
        requestId: 'invalid/request-id',
      }),
    /ores-interfaces identifier/,
  );
  const completedDuringBackoff = createProtocolSyncTelemetryRecord({
    runtime: 'typescript',
    kind: 'cycle.completed',
    status: 'backoff',
    timestamp: '2026-08-11T17:53:28.151Z',
    cycle: {
      pushedMutations: 0,
      acknowledgedMutations: 0,
      pulledChanges: 0,
      installedSnapshots: 0,
      checkpoint: null,
      hasMorePending: false,
    },
  });
  assert.equal(completedDuringBackoff.severityText, 'INFO');
  assert.equal(completedDuringBackoff.severityNumber, 9);
});

test('browser entry exposes the same observability contract', () => {
  assert.equal(typeof browserEntry.createProtocolSyncTelemetryRecord, 'function');
  assert.equal(
    typeof browserEntry.observability.createProtocolSyncTelemetryRecord,
    'function',
  );
  assert.equal(
    browserEntry.createProtocolSyncTelemetryRecord({
      runtime: 'typescript',
      kind: 'state.changed',
      status: 'idle',
      timestamp: '2026-08-11T17:53:28.151Z',
    }).attributes['opto.sync.schema'],
    'opto-sync.telemetry/v1',
  );
});
