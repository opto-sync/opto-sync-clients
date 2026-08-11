import 'protocol_sync_loop.dart';

const String optoSyncTelemetrySchema = 'opto-sync.telemetry/v1';

enum ProtocolSyncTelemetryRuntime { typescript, dart, rust }

enum ProtocolSyncTelemetryKind { stateChanged, cycleCompleted, cycleFailed }

class ProtocolSyncTelemetryInput {
  final ProtocolSyncTelemetryRuntime runtime;
  final ProtocolSyncTelemetryKind kind;
  final ProtocolSyncStatus status;
  final int consecutiveFailures;
  /// Explicit event time; required for deterministic cross-runtime records.
  final DateTime timestamp;
  final DateTime? nextRetryAt;
  final ProtocolSyncCycleResult? cycle;

  /// Stable machine code only. Raw exception messages are unsupported.
  final String? errorCode;

  /// Correlation identifier from the ores-interfaces request context.
  final String? requestId;
  final String? traceId;
  final String? spanId;
  final int? traceFlags;
  final String? traceState;

  const ProtocolSyncTelemetryInput({
    required this.runtime,
    required this.kind,
    required this.status,
    this.consecutiveFailures = 0,
    required this.timestamp,
    this.nextRetryAt,
    this.cycle,
    this.errorCode,
    this.requestId,
    this.traceId,
    this.spanId,
    this.traceFlags,
    this.traceState,
  });
}

final RegExp _errorCode = RegExp(r'^[A-Z][A-Z0-9_.-]{0,127}$');
final RegExp _requestId = RegExp(r'^[A-Za-z0-9._:-]{8,128}$');
final RegExp _traceId = RegExp(r'^(?!0{32}$)[0-9a-f]{32}$');
final RegExp _spanId = RegExp(r'^(?!0{16}$)[0-9a-f]{16}$');
const int _maximumSafeInteger = 9007199254740991;

int _count(int value, String name) {
  if (value < 0 || value > _maximumSafeInteger) {
    throw RangeError('$name must be a non-negative interoperable integer');
  }
  return value;
}

String _timestamp(DateTime value) {
  final utc = value.toUtc();
  if (utc.year < 0 || utc.year > 9999) {
    throw RangeError('telemetry timestamp year must be from 0000 through 9999');
  }
  String digits(int value, int width) => value.toString().padLeft(width, '0');
  return '${digits(utc.year, 4)}-${digits(utc.month, 2)}-'
      '${digits(utc.day, 2)}T${digits(utc.hour, 2)}:'
      '${digits(utc.minute, 2)}:${digits(utc.second, 2)}.'
      '${digits(utc.millisecond, 3)}Z';
}

String _event(ProtocolSyncTelemetryKind kind) => switch (kind) {
  ProtocolSyncTelemetryKind.stateChanged => 'opto.sync.state.changed',
  ProtocolSyncTelemetryKind.cycleCompleted => 'opto.sync.cycle.completed',
  ProtocolSyncTelemetryKind.cycleFailed => 'opto.sync.cycle.failed',
};

String _body(ProtocolSyncTelemetryKind kind) => switch (kind) {
  ProtocolSyncTelemetryKind.stateChanged => 'opto-sync state changed',
  ProtocolSyncTelemetryKind.cycleCompleted =>
    'opto-sync sync cycle completed',
  ProtocolSyncTelemetryKind.cycleFailed => 'opto-sync sync cycle failed',
};

(String, int) _severity(
  ProtocolSyncTelemetryKind kind,
  ProtocolSyncStatus status,
) {
  if (kind == ProtocolSyncTelemetryKind.cycleFailed) {
    return ('ERROR', 17);
  }
  if (kind == ProtocolSyncTelemetryKind.cycleCompleted) {
    return ('INFO', 9);
  }
  if (status == ProtocolSyncStatus.error) return ('ERROR', 17);
  if (status == ProtocolSyncStatus.backoff ||
      status == ProtocolSyncStatus.offline) {
    return ('WARN', 13);
  }
  return ('INFO', 9);
}

/// Create the shared privacy-bounded ores.otel.log bridge record.
///
/// The API exposes no fields for queue payloads, domain record identifiers,
/// checkpoints, URLs, headers, or raw exception messages. Callers must still
/// pass only non-secret machine codes and correlation values. The application
/// owns the ORE/OpenTelemetry transport and exporter.
Map<String, Object> createProtocolSyncTelemetryRecord(
  ProtocolSyncTelemetryInput input,
) {
  _count(input.consecutiveFailures, 'consecutiveFailures');
  if (input.consecutiveFailures > 2147483647) {
    throw RangeError('consecutiveFailures exceeds the telemetry schema bound');
  }
  if (input.kind == ProtocolSyncTelemetryKind.cycleCompleted &&
      input.cycle == null) {
    throw ArgumentError('cycleCompleted telemetry requires a cycle result');
  }
  if (input.kind == ProtocolSyncTelemetryKind.cycleFailed &&
      input.errorCode == null) {
    throw ArgumentError('cycleFailed telemetry requires a stable errorCode');
  }
  if (input.errorCode case final code?) {
    if (!_errorCode.hasMatch(code)) {
      throw ArgumentError('errorCode must be a stable uppercase machine code');
    }
  }
  if (input.requestId case final request?) {
    if (!_requestId.hasMatch(request)) {
      throw ArgumentError(
        'requestId is not a valid ores-interfaces identifier',
      );
    }
  }
  if (input.traceId case final trace?) {
    if (!_traceId.hasMatch(trace)) {
      throw ArgumentError('traceId must be a non-zero lowercase W3C trace id');
    }
  }
  if (input.spanId case final span?) {
    if (!_spanId.hasMatch(span)) {
      throw ArgumentError('spanId must be a non-zero lowercase W3C span id');
    }
  }
  if (input.traceFlags case final flags?) {
    if (flags < 0 || flags > 255) {
      throw RangeError.range(flags, 0, 255, 'traceFlags');
    }
  }
  if ((input.traceState?.runes.length ?? 0) > 512) {
    throw RangeError('traceState must not exceed 512 characters');
  }

  final attributes = <String, Object>{
    'service.name': 'opto-sync',
    'event.name': _event(input.kind),
    'opto.sync.schema': optoSyncTelemetrySchema,
    'opto.sync.runtime': input.runtime.name,
    'opto.sync.status': input.status.name,
    'opto.sync.consecutive_failures': input.consecutiveFailures,
    if (input.nextRetryAt case final retry?)
      'opto.sync.next_retry_at': _timestamp(retry),
    if (input.errorCode case final code?) 'error.code': code,
    if (input.requestId case final request?) 'request.id': request,
  };
  if (input.kind == ProtocolSyncTelemetryKind.cycleCompleted) {
    final cycle = input.cycle!;
    attributes.addAll({
      'opto.sync.pushed_mutations': _count(
        cycle.pushedMutations,
        'cycle.pushedMutations',
      ),
      'opto.sync.acknowledged_mutations': _count(
        cycle.acknowledgedMutations,
        'cycle.acknowledgedMutations',
      ),
      'opto.sync.pulled_changes': _count(
        cycle.pulledChanges,
        'cycle.pulledChanges',
      ),
      'opto.sync.installed_snapshots': _count(
        cycle.installedSnapshots,
        'cycle.installedSnapshots',
      ),
      'opto.sync.has_more_pending': cycle.hasMorePending,
    });
  }

  final (severityText, severityNumber) = _severity(input.kind, input.status);
  return <String, Object>{
    'body': _body(input.kind),
    'severityText': severityText,
    'severityNumber': severityNumber,
    'timestamp': _timestamp(input.timestamp),
    'attributes': attributes,
    if (input.traceId case final trace?) 'traceId': trace,
    if (input.spanId case final span?) 'spanId': span,
    if (input.traceFlags case final flags?) 'traceFlags': flags,
    if (input.traceState case final state?) 'traceState': state,
  };
}

/// Convert a loop state into the common explicit telemetry record.
Map<String, Object> protocolSyncStateTelemetry(
  ProtocolSyncTelemetryRuntime runtime,
  ProtocolSyncState state, {
  required DateTime timestamp,
  String? errorCode,
  String? requestId,
  String? traceId,
  String? spanId,
  int? traceFlags,
  String? traceState,
}) => createProtocolSyncTelemetryRecord(
  ProtocolSyncTelemetryInput(
    runtime: runtime,
    kind: ProtocolSyncTelemetryKind.stateChanged,
    status: state.status,
    consecutiveFailures: state.consecutiveFailures,
    timestamp: timestamp,
    nextRetryAt: state.nextRetryAt,
    errorCode: errorCode,
    requestId: requestId,
    traceId: traceId,
    spanId: spanId,
    traceFlags: traceFlags,
    traceState: traceState,
  ),
);
