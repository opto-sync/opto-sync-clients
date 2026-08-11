/**
 * Injection-only structured telemetry for opto-sync lifecycle adapters.
 *
 * Applications adapt TelemetrySink to `@oresoftware/next-loggers`. This module
 * never installs a global OpenTelemetry provider and exposes only the metadata
 * allowlist in schema/opto-sync-telemetry-event.schema.json.
 */
import type { ProtocolSyncCycleResult } from './sync-loop.js';

export const TELEMETRY_SCHEMA_VERSION = 1 as const;

export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TelemetryFields {
  readonly operation?: string;
  readonly table?: string;
  readonly recordId?: string;
  readonly mutationId?: string;
  readonly checkpoint?: string;
  readonly status?: string;
  readonly code?: string;
  readonly durationMs?: number;
  readonly pushedMutations?: number;
  readonly acknowledgedMutations?: number;
  readonly pulledChanges?: number;
  readonly installedSnapshots?: number;
  readonly hasMorePending?: boolean;
  readonly consecutiveFailures?: number;
}

export interface TelemetryEvent {
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly name: string;
  readonly level: TelemetryLevel;
  readonly fields: Readonly<TelemetryFields>;
}

export type TelemetrySink = (
  event: Readonly<TelemetryEvent>,
) => void | Promise<void>;

const eventName = /^opto_sync(?:\.[a-z][a-z0-9_]*){2,4}$/u;
const canonicalDecimal = /^(?:0|[1-9][0-9]*)$/u;
const stableCode = /^[A-Z][A-Z0-9_]{0,63}$/u;
const levels = new Set<TelemetryLevel>(['debug', 'info', 'warn', 'error']);
const fieldNames = [
  'operation',
  'table',
  'recordId',
  'mutationId',
  'checkpoint',
  'status',
  'code',
  'durationMs',
  'pushedMutations',
  'acknowledgedMutations',
  'pulledChanges',
  'installedSnapshots',
  'hasMorePending',
  'consecutiveFailures',
] as const satisfies readonly (keyof TelemetryFields)[];

function validString(
  value: unknown,
  maxCodePoints?: number,
  pattern?: RegExp,
): boolean {
  return value === undefined || (
    typeof value === 'string'
    && (maxCodePoints === undefined || [...value].length <= maxCodePoints)
    && (pattern === undefined || pattern.test(value))
  );
}

function validCount(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
  );
}

function validFields(fields: Partial<Record<keyof TelemetryFields, unknown>>): boolean {
  return validString(fields.operation, 64)
    && validString(fields.table, 63)
    && validString(fields.recordId, 512)
    && validString(fields.mutationId, undefined, canonicalDecimal)
    && validString(fields.checkpoint, undefined, canonicalDecimal)
    && validString(fields.status, 48)
    && validString(fields.code, 64, stableCode)
    && validCount(fields.durationMs)
    && validCount(fields.pushedMutations)
    && validCount(fields.acknowledgedMutations)
    && validCount(fields.pulledChanges)
    && validCount(fields.installedSnapshots)
    && (fields.hasMorePending === undefined || typeof fields.hasMorePending === 'boolean')
    && validCount(fields.consecutiveFailures);
}

export function createTelemetryEvent(
  name: string,
  level: TelemetryLevel,
  fields: TelemetryFields = {},
): Readonly<TelemetryEvent> {
  if (typeof name !== 'string' || name.length > 128 || !eventName.test(name)) {
    throw new TypeError('telemetry event name must use the opto_sync namespace');
  }
  if (!levels.has(level)) {
    throw new TypeError('telemetry event level must conform to the canonical JSON Schema');
  }
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('telemetry event fields must be an object');
  }
  // Runtime callers may be untyped JavaScript. Copy only the closed allowlist
  // so `payload`, `token`, request/response bodies, and other arbitrary fields
  // cannot cross the telemetry boundary even through an `as any` escape hatch.
  const safeFields: Partial<Record<keyof TelemetryFields, unknown>> = {};
  for (const field of fieldNames) {
    const value = fields[field];
    if (value !== undefined) safeFields[field] = value;
  }
  if (!validFields(safeFields)) {
    throw new TypeError('telemetry event fields must conform to the canonical JSON Schema');
  }
  return Object.freeze({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    name,
    level,
    fields: Object.freeze(safeFields) as Readonly<TelemetryFields>,
  });
}

/** Best-effort emission. Logger failures cannot alter sync behavior. */
export async function emitTelemetry(
  sink: TelemetrySink | undefined,
  event: Readonly<TelemetryEvent>,
): Promise<void> {
  if (!sink) return;
  try {
    // Rebuild at the final sink boundary so untyped JavaScript cannot bypass
    // the factory by passing a hand-written event carrying arbitrary fields.
    const safeEvent = createTelemetryEvent(event.name, event.level, event.fields);
    await sink(safeEvent);
  } catch {
    // Observability is deliberately fail-open with respect to synchronization.
  }
}

async function emitLifecycle(
  sink: TelemetrySink | undefined,
  name: string,
  level: TelemetryLevel,
  fields: TelemetryFields,
): Promise<void> {
  try {
    await emitTelemetry(sink, createTelemetryEvent(name, level, fields));
  } catch {
    // Invalid derived metadata is dropped; the sync result remains primary.
  }
}

/**
 * Observe an existing ProtocolSyncLoop.syncNow call without changing its
 * result. Failures emit only a stable code, never the error text, request,
 * response, credential, or mutation payload.
 */
export async function observeSyncCycle(
  sink: TelemetrySink | undefined,
  sync: () => Promise<ProtocolSyncCycleResult>,
): Promise<ProtocolSyncCycleResult> {
  await emitLifecycle(
    sink,
    'opto_sync.sync.cycle_started',
    'debug',
    {
      operation: 'protocolSyncCycle',
    },
  );
  try {
    const result = await sync();
    await emitLifecycle(
      sink,
      'opto_sync.sync.cycle_succeeded',
      'info',
      {
        operation: 'protocolSyncCycle',
        checkpoint: result.checkpoint,
        pushedMutations: result.pushedMutations,
        acknowledgedMutations: result.acknowledgedMutations,
        pulledChanges: result.pulledChanges,
        installedSnapshots: result.installedSnapshots,
        hasMorePending: result.hasMorePending,
      },
    );
    return result;
  } catch (error) {
    await emitLifecycle(
      sink,
      'opto_sync.sync.cycle_failed',
      'error',
      {
        operation: 'protocolSyncCycle',
        code: 'SYNC_CYCLE_FAILED',
      },
    );
    throw error;
  }
}
