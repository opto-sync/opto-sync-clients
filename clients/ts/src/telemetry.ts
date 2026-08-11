/**
 * Fail-open delivery for the canonical Ores/OpenTelemetry bridge record.
 *
 * The record is always rebuilt from ProtocolSyncTelemetryInput at the final
 * sink boundary. Untyped callers therefore cannot smuggle checkpoints,
 * record identifiers, payloads, credentials, or arbitrary attributes into an
 * application-owned `ores.otel.log` transport.
 */
import {
  createProtocolSyncTelemetryRecord,
  type OresOpenTelemetryLogRecord,
  type ProtocolSyncTelemetryInput,
} from './observability.js';

export type ProtocolSyncTelemetrySink = (
  record: Readonly<OresOpenTelemetryLogRecord>,
) => void | Promise<void>;

/** Backwards-compatible name for an application-injected telemetry sink. */
export type TelemetrySink = ProtocolSyncTelemetrySink;

/**
 * Build and deliver one canonical record without ever changing sync behavior.
 * Invalid derived metadata, throwing getters, rejected promises, and sink
 * exceptions are contained at this boundary.
 */
export async function emitProtocolSyncTelemetry(
  sink: ProtocolSyncTelemetrySink | undefined,
  input: ProtocolSyncTelemetryInput,
): Promise<void> {
  if (!sink) return;
  try {
    const record = createProtocolSyncTelemetryRecord(input);
    const safeRecord = Object.freeze({
      ...record,
      attributes: Object.freeze({ ...record.attributes }),
    });
    await sink(safeRecord);
  } catch {
    // Observability is deliberately fail-open with respect to synchronization.
  }
}

/** @deprecated Use emitProtocolSyncTelemetry. */
export const emitTelemetry = emitProtocolSyncTelemetry;
