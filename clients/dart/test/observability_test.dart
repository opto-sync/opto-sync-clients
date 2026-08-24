import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

void main() {
  test('cycle telemetry matches the shared ORE fixture', () async {
    final expected = jsonDecode(
      await File(
        '../../schema/telemetry-fixtures/valid/cycle-completed.json',
      ).readAsString(),
    );
    final record = createProtocolSyncTelemetryRecord(
      ProtocolSyncTelemetryInput(
        runtime: ProtocolSyncTelemetryRuntime.typescript,
        kind: ProtocolSyncTelemetryKind.cycleCompleted,
        status: ProtocolSyncStatus.idle,
        timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
        requestId: 'sync-cycle-42',
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        traceFlags: 1,
        cycle: const ProtocolSyncCycleResult(
          pushedMutations: 3,
          acknowledgedMutations: 3,
          pulledChanges: 2,
          installedSnapshots: 0,
          checkpoint: 'private-high-cardinality-value',
          hasMorePending: false,
        ),
      ),
    );
    expect(record, expected);
    expect(
      jsonEncode(record),
      isNot(contains('private-high-cardinality-value')),
    );
  });

  test('state adapter keeps raw local errors out of the record', () {
    final record = protocolSyncStateTelemetry(
      ProtocolSyncTelemetryRuntime.dart,
      ProtocolSyncState(
        status: ProtocolSyncStatus.backoff,
        consecutiveFailures: 2,
        nextRetryAt: DateTime.parse('2026-08-11T17:53:30.151Z'),
        lastError: 'contains a URL, record id, or secret and must stay local',
      ),
      timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
      errorCode: 'SYNC_TRANSPORT_ERROR',
    );
    expect(record['severityText'], 'WARN');
    expect((record['attributes'] as Map)['error.code'], 'SYNC_TRANSPORT_ERROR');
    expect(jsonEncode(record), isNot(contains('must stay local')));
    expect(
      () => createProtocolSyncTelemetryRecord(
        ProtocolSyncTelemetryInput(
          runtime: ProtocolSyncTelemetryRuntime.dart,
          kind: ProtocolSyncTelemetryKind.cycleFailed,
          status: ProtocolSyncStatus.error,
          timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
          errorCode: 'raw exception message is not a code',
        ),
      ),
      throwsArgumentError,
    );
    for (final requestId in ['short', 'invalid/request-id']) {
      expect(
        () => createProtocolSyncTelemetryRecord(
          ProtocolSyncTelemetryInput(
            runtime: ProtocolSyncTelemetryRuntime.dart,
            kind: ProtocolSyncTelemetryKind.stateChanged,
            status: ProtocolSyncStatus.idle,
            timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
            requestId: requestId,
          ),
        ),
        throwsArgumentError,
      );
    }
    expect(
      () => createProtocolSyncTelemetryRecord(
        ProtocolSyncTelemetryInput(
          runtime: ProtocolSyncTelemetryRuntime.dart,
          kind: ProtocolSyncTelemetryKind.stateChanged,
          status: ProtocolSyncStatus.idle,
          timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
          traceState: List.filled(512, '🥽').join(),
        ),
      ),
      returnsNormally,
    );
    expect(
      () => createProtocolSyncTelemetryRecord(
        ProtocolSyncTelemetryInput(
          runtime: ProtocolSyncTelemetryRuntime.dart,
          kind: ProtocolSyncTelemetryKind.stateChanged,
          status: ProtocolSyncStatus.idle,
          timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
          traceState: List.filled(513, '🥽').join(),
        ),
      ),
      throwsRangeError,
    );
  });
}
