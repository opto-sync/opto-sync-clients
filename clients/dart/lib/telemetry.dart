/// Fail-open delivery for the canonical Ores/OpenTelemetry bridge record.
///
/// The record is always rebuilt from [ProtocolSyncTelemetryInput] at the final
/// sink boundary. This library never installs a global provider, owns logger
/// shutdown, or exposes payload/checkpoint/record fields to the sink.
library;

import 'dart:async';

import 'src/observability.dart';

export 'src/observability.dart';

typedef ProtocolSyncTelemetrySink =
    FutureOr<void> Function(Map<String, Object> record);

/// Backwards-compatible name for an application-injected telemetry sink.
typedef TelemetrySink = ProtocolSyncTelemetrySink;

/// Build and deliver one canonical record without changing sync behavior.
///
/// Invalid derived metadata, overridden getters, and sink failures are all
/// contained at this boundary.
Future<void> emitProtocolSyncTelemetry(
  ProtocolSyncTelemetrySink? sink,
  ProtocolSyncTelemetryInput input,
) async {
  if (sink == null) return;
  try {
    final record = createProtocolSyncTelemetryRecord(input);
    final attributes = Map<String, Object>.unmodifiable(
      record['attributes']! as Map<String, Object>,
    );
    final safeRecord = Map<String, Object>.unmodifiable({
      ...record,
      'attributes': attributes,
    });
    await sink(safeRecord);
  } catch (_) {
    // Observability is deliberately fail-open with respect to synchronization.
  }
}

/// Deprecated compatibility spelling; use [emitProtocolSyncTelemetry].
Future<void> emitTelemetry(
  ProtocolSyncTelemetrySink? sink,
  ProtocolSyncTelemetryInput input,
) => emitProtocolSyncTelemetry(sink, input);
