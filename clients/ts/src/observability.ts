import type {
  ProtocolSyncCycleResult,
  ProtocolSyncState,
  ProtocolSyncStatus,
} from './sync-loop.js';

export const OPTO_SYNC_TELEMETRY_SCHEMA = 'opto-sync.telemetry/v1' as const;

export type ProtocolSyncTelemetryRuntime = 'typescript' | 'dart' | 'rust';
export type ProtocolSyncTelemetryKind =
  | 'state.changed'
  | 'cycle.completed'
  | 'cycle.failed';

export type OresTelemetryAttribute = string | number | boolean;

/**
 * The explicit OpenTelemetry bridge record accepted by ores.otel.log.
 *
 * This package creates records only. It never registers a global provider,
 * chooses an exporter, or sends telemetry on its own.
 */
export interface OresOpenTelemetryLogRecord {
  body: string;
  severityText: 'INFO' | 'WARN' | 'ERROR';
  severityNumber: 9 | 13 | 17;
  timestamp: string;
  attributes: Record<string, OresTelemetryAttribute>;
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
  traceState?: string;
}

export interface ProtocolSyncTelemetryInput {
  runtime: ProtocolSyncTelemetryRuntime;
  kind: ProtocolSyncTelemetryKind;
  status: ProtocolSyncStatus;
  consecutiveFailures?: number;
  timestamp?: Date | string | number;
  nextRetryAt?: Date | string | number;
  cycle?: Readonly<ProtocolSyncCycleResult>;
  /** Stable machine code only. Raw exception messages are deliberately unsupported. */
  errorCode?: string;
  /** Correlation identifier from the ores-interfaces request context. */
  requestId?: string;
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
  /** Non-secret W3C tracestate only; callers must not embed credentials. */
  traceState?: string;
}

const ERROR_CODE = /^[A-Z][A-Z0-9_.-]{0,127}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const RUNTIMES = new Set<ProtocolSyncTelemetryRuntime>([
  'typescript',
  'dart',
  'rust',
]);
const KINDS = new Set<ProtocolSyncTelemetryKind>([
  'state.changed',
  'cycle.completed',
  'cycle.failed',
]);
const STATUSES = new Set<ProtocolSyncStatus>([
  'stopped',
  'idle',
  'syncing',
  'offline',
  'backoff',
  'error',
]);

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function canonicalTimestamp(
  value: Date | string | number | undefined,
  name: string,
): string {
  const instant = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError(`${name} must be a valid instant`);
  }
  const output = instant.toISOString();
  if (!CANONICAL_TIMESTAMP.test(output)) {
    throw new RangeError(`${name} must fit the canonical four-digit UTC year`);
  }
  return output;
}

function severity(
  kind: ProtocolSyncTelemetryKind,
  status: ProtocolSyncStatus,
): Pick<OresOpenTelemetryLogRecord, 'severityText' | 'severityNumber'> {
  if (kind === 'cycle.failed') {
    return { severityText: 'ERROR', severityNumber: 17 };
  }
  if (kind === 'cycle.completed') {
    return { severityText: 'INFO', severityNumber: 9 };
  }
  if (status === 'error') return { severityText: 'ERROR', severityNumber: 17 };
  if (status === 'backoff' || status === 'offline') {
    return { severityText: 'WARN', severityNumber: 13 };
  }
  return { severityText: 'INFO', severityNumber: 9 };
}

function body(kind: ProtocolSyncTelemetryKind): string {
  switch (kind) {
    case 'state.changed':
      return 'opto-sync state changed';
    case 'cycle.completed':
      return 'opto-sync sync cycle completed';
    case 'cycle.failed':
      return 'opto-sync sync cycle failed';
  }
}

function eventName(kind: ProtocolSyncTelemetryKind): string {
  return `opto.sync.${kind}`;
}

/**
 * Build the shared privacy-bounded telemetry record.
 *
 * This API exposes no fields for queue payloads, domain record identifiers,
 * checkpoints, URLs, headers, or raw error messages. Callers must still pass
 * only non-secret machine codes and correlation values. Hand the result to an
 * application-owned ores.otel.log transport or another OTEL-compatible sink.
 */
export function createProtocolSyncTelemetryRecord(
  input: ProtocolSyncTelemetryInput,
): OresOpenTelemetryLogRecord {
  if (!RUNTIMES.has(input.runtime)) throw new TypeError('unsupported telemetry runtime');
  if (!KINDS.has(input.kind)) throw new TypeError('unsupported telemetry kind');
  if (!STATUSES.has(input.status)) throw new TypeError('unsupported sync status');
  const failures = nonNegativeInteger(
    input.consecutiveFailures ?? 0,
    'consecutiveFailures',
  );
  if (failures > 2_147_483_647) {
    throw new RangeError('consecutiveFailures exceeds the telemetry schema bound');
  }
  if (
    input.kind === 'cycle.completed' &&
    (typeof input.cycle !== 'object' || input.cycle === null)
  ) {
    throw new TypeError('cycle.completed telemetry requires a cycle result');
  }
  if (input.kind === 'cycle.failed' && input.errorCode === undefined) {
    throw new TypeError('cycle.failed telemetry requires a stable errorCode');
  }
  if (
    input.errorCode !== undefined &&
    (typeof input.errorCode !== 'string' || !ERROR_CODE.test(input.errorCode))
  ) {
    throw new TypeError('errorCode must be a stable uppercase machine code');
  }
  if (
    input.requestId !== undefined &&
    (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId))
  ) {
    throw new TypeError('requestId is not a valid ores-interfaces identifier');
  }
  if (
    input.traceId !== undefined &&
    (typeof input.traceId !== 'string' || !TRACE_ID.test(input.traceId))
  ) {
    throw new TypeError('traceId must be a non-zero lowercase W3C trace id');
  }
  if (
    input.spanId !== undefined &&
    (typeof input.spanId !== 'string' || !SPAN_ID.test(input.spanId))
  ) {
    throw new TypeError('spanId must be a non-zero lowercase W3C span id');
  }
  if (
    input.traceFlags !== undefined &&
    (!Number.isInteger(input.traceFlags) || input.traceFlags < 0 || input.traceFlags > 255)
  ) {
    throw new RangeError('traceFlags must be an integer from 0 through 255');
  }
  if (
    input.traceState !== undefined &&
    (typeof input.traceState !== 'string' ||
      Array.from(input.traceState).length > 512)
  ) {
    throw new RangeError('traceState must be a string of at most 512 characters');
  }

  const attributes: Record<string, OresTelemetryAttribute> = {
    'service.name': 'opto-sync',
    'event.name': eventName(input.kind),
    'opto.sync.schema': OPTO_SYNC_TELEMETRY_SCHEMA,
    'opto.sync.runtime': input.runtime,
    'opto.sync.status': input.status,
    'opto.sync.consecutive_failures': failures,
  };
  if (input.nextRetryAt !== undefined) {
    attributes['opto.sync.next_retry_at'] = canonicalTimestamp(
      input.nextRetryAt,
      'nextRetryAt',
    );
  }
  if (input.errorCode !== undefined) attributes['error.code'] = input.errorCode;
  if (input.requestId !== undefined) attributes['request.id'] = input.requestId;

  const cycle = input.cycle;
  if (input.kind === 'cycle.completed' && cycle !== undefined) {
    if (typeof cycle.hasMorePending !== 'boolean') {
      throw new TypeError('cycle.hasMorePending must be a boolean');
    }
    attributes['opto.sync.pushed_mutations'] = nonNegativeInteger(
      cycle.pushedMutations,
      'cycle.pushedMutations',
    );
    attributes['opto.sync.acknowledged_mutations'] = nonNegativeInteger(
      cycle.acknowledgedMutations,
      'cycle.acknowledgedMutations',
    );
    attributes['opto.sync.pulled_changes'] = nonNegativeInteger(
      cycle.pulledChanges,
      'cycle.pulledChanges',
    );
    attributes['opto.sync.installed_snapshots'] = nonNegativeInteger(
      cycle.installedSnapshots,
      'cycle.installedSnapshots',
    );
    attributes['opto.sync.has_more_pending'] = cycle.hasMorePending;
  }

  return {
    body: body(input.kind),
    ...severity(input.kind, input.status),
    timestamp: canonicalTimestamp(input.timestamp, 'timestamp'),
    attributes,
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    ...(input.spanId === undefined ? {} : { spanId: input.spanId }),
    ...(input.traceFlags === undefined ? {} : { traceFlags: input.traceFlags }),
    ...(input.traceState === undefined ? {} : { traceState: input.traceState }),
  };
}

/** Convert a loop state into the common explicit telemetry input. */
export function protocolSyncStateTelemetry(
  runtime: ProtocolSyncTelemetryRuntime,
  state: Readonly<ProtocolSyncState>,
  overrides: Omit<
    ProtocolSyncTelemetryInput,
    'runtime' | 'kind' | 'status' | 'consecutiveFailures' | 'nextRetryAt'
  > = {},
): OresOpenTelemetryLogRecord {
  return createProtocolSyncTelemetryRecord({
    ...overrides,
    runtime,
    kind: 'state.changed',
    status: state.status,
    consecutiveFailures: state.consecutiveFailures,
    nextRetryAt: state.nextRetryAt,
  });
}
