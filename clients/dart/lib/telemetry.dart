/// Injection-only structured telemetry for opto-sync lifecycle adapters.
///
/// Applications adapt [TelemetrySink] to `oresoftware_next_loggers`. This
/// library never installs a global OpenTelemetry provider, never owns logger
/// shutdown, and exposes only the metadata allowlist in
/// `schema/opto-sync-telemetry-event.schema.json`.
library;

import 'dart:async';

import 'src/protocol_sync_loop.dart';

const int telemetrySchemaVersion = 1;

enum TelemetryLevel { debug, info, warn, error }

class TelemetryFields {
  const TelemetryFields({
    this.operation,
    this.table,
    this.recordId,
    this.mutationId,
    this.checkpoint,
    this.status,
    this.code,
    this.durationMs,
    this.pushedMutations,
    this.acknowledgedMutations,
    this.pulledChanges,
    this.installedSnapshots,
    this.hasMorePending,
    this.consecutiveFailures,
  });

  final String? operation;
  final String? table;
  final String? recordId;
  final String? mutationId;
  final String? checkpoint;
  final String? status;
  final String? code;
  final int? durationMs;
  final int? pushedMutations;
  final int? acknowledgedMutations;
  final int? pulledChanges;
  final int? installedSnapshots;
  final bool? hasMorePending;
  final int? consecutiveFailures;

  Map<String, Object> toJson() => <String, Object>{
    'operation': ?operation,
    'table': ?table,
    'recordId': ?recordId,
    'mutationId': ?mutationId,
    'checkpoint': ?checkpoint,
    'status': ?status,
    'code': ?code,
    'durationMs': ?durationMs,
    'pushedMutations': ?pushedMutations,
    'acknowledgedMutations': ?acknowledgedMutations,
    'pulledChanges': ?pulledChanges,
    'installedSnapshots': ?installedSnapshots,
    'hasMorePending': ?hasMorePending,
    'consecutiveFailures': ?consecutiveFailures,
  };
}

class TelemetryEvent {
  TelemetryEvent._(this.name, this.level, this.fields);

  final int schemaVersion = telemetrySchemaVersion;
  final String name;
  final TelemetryLevel level;
  final TelemetryFields fields;

  Map<String, Object> toJson() => <String, Object>{
    'schemaVersion': schemaVersion,
    'name': name,
    'level': level.name,
    'fields': fields.toJson(),
  };
}

final RegExp _eventName = RegExp(r'^opto_sync(?:\.[a-z][a-z0-9_]*){2,4}$');
final RegExp _canonicalDecimal = RegExp(r'^(?:0|[1-9][0-9]*)$');
final RegExp _stableCode = RegExp(r'^[A-Z][A-Z0-9_]{0,63}$');

bool _atMost(String? value, int maxCodePoints) =>
    value == null || value.runes.length <= maxCodePoints;

bool _validFields(TelemetryFields fields) =>
    _atMost(fields.operation, 64) &&
    _atMost(fields.table, 63) &&
    _atMost(fields.recordId, 512) &&
    (fields.mutationId == null ||
        _canonicalDecimal.hasMatch(fields.mutationId!)) &&
    (fields.checkpoint == null ||
        _canonicalDecimal.hasMatch(fields.checkpoint!)) &&
    _atMost(fields.status, 48) &&
    (fields.code == null || _stableCode.hasMatch(fields.code!)) &&
    (fields.durationMs == null || fields.durationMs! >= 0) &&
    (fields.pushedMutations == null || fields.pushedMutations! >= 0) &&
    (fields.acknowledgedMutations == null ||
        fields.acknowledgedMutations! >= 0) &&
    (fields.pulledChanges == null || fields.pulledChanges! >= 0) &&
    (fields.installedSnapshots == null || fields.installedSnapshots! >= 0) &&
    (fields.consecutiveFailures == null || fields.consecutiveFailures! >= 0);

TelemetryEvent createTelemetryEvent(
  String name,
  TelemetryLevel level, [
  TelemetryFields fields = const TelemetryFields(),
]) {
  if (name.length > 128 || !_eventName.hasMatch(name)) {
    throw ArgumentError.value(name, 'name', 'must use the opto_sync namespace');
  }
  // Copy each allowlisted getter into the concrete base type. Dart classes are
  // implicit interfaces, so retaining a caller implementation would let it
  // override toJson() and add fields that the canonical schema prohibits.
  final safeFields = TelemetryFields(
    operation: fields.operation,
    table: fields.table,
    recordId: fields.recordId,
    mutationId: fields.mutationId,
    checkpoint: fields.checkpoint,
    status: fields.status,
    code: fields.code,
    durationMs: fields.durationMs,
    pushedMutations: fields.pushedMutations,
    acknowledgedMutations: fields.acknowledgedMutations,
    pulledChanges: fields.pulledChanges,
    installedSnapshots: fields.installedSnapshots,
    hasMorePending: fields.hasMorePending,
    consecutiveFailures: fields.consecutiveFailures,
  );
  if (!_validFields(safeFields)) {
    throw ArgumentError.value(
      fields,
      'fields',
      'must conform to the canonical telemetry JSON Schema',
    );
  }
  return TelemetryEvent._(name, level, safeFields);
}

typedef TelemetrySink = FutureOr<void> Function(TelemetryEvent event);

/// Best-effort emission. Logger failures cannot alter sync behavior.
Future<void> emitTelemetry(TelemetrySink? sink, TelemetryEvent event) async {
  if (sink == null) return;
  try {
    // Rebuild at the final sink boundary so an external implementation of the
    // implicit Dart interface cannot bypass the canonical field validation.
    final safeEvent = createTelemetryEvent(
      event.name,
      event.level,
      event.fields,
    );
    await sink(safeEvent);
  } catch (_) {
    // Observability is deliberately fail-open with respect to synchronization.
  }
}

Future<void> _emitLifecycle(
  TelemetrySink? sink,
  String name,
  TelemetryLevel level,
  TelemetryFields fields,
) async {
  try {
    await emitTelemetry(sink, createTelemetryEvent(name, level, fields));
  } catch (_) {
    // Invalid derived metadata is dropped; the sync result remains primary.
  }
}

/// Observe an existing [ProtocolSyncLoop.syncNow] call without changing its
/// result. Failures emit only a stable code, never a possibly-sensitive error
/// message, request, response, or mutation payload.
Future<ProtocolSyncCycleResult> observeSyncCycle(
  TelemetrySink? sink,
  Future<ProtocolSyncCycleResult> Function() sync,
) async {
  await _emitLifecycle(
    sink,
    'opto_sync.sync.cycle_started',
    TelemetryLevel.debug,
    const TelemetryFields(operation: 'protocolSyncCycle'),
  );
  try {
    final result = await sync();
    await _emitLifecycle(
      sink,
      'opto_sync.sync.cycle_succeeded',
      TelemetryLevel.info,
      TelemetryFields(
        operation: 'protocolSyncCycle',
        checkpoint: result.checkpoint,
        pushedMutations: result.pushedMutations,
        acknowledgedMutations: result.acknowledgedMutations,
        pulledChanges: result.pulledChanges,
        installedSnapshots: result.installedSnapshots,
        hasMorePending: result.hasMorePending,
      ),
    );
    return result;
  } catch (error, stack) {
    await _emitLifecycle(
      sink,
      'opto_sync.sync.cycle_failed',
      TelemetryLevel.error,
      const TelemetryFields(
        operation: 'protocolSyncCycle',
        code: 'SYNC_CYCLE_FAILED',
      ),
    );
    Error.throwWithStackTrace(error, stack);
  }
}
