import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

final stateInput = ProtocolSyncTelemetryInput(
  runtime: ProtocolSyncTelemetryRuntime.dart,
  kind: ProtocolSyncTelemetryKind.stateChanged,
  status: ProtocolSyncStatus.idle,
  consecutiveFailures: 0,
  timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
  requestId: 'sync-cycle-42',
);

void main() {
  test('a failing telemetry sink is contained', () async {
    var calls = 0;
    await emitProtocolSyncTelemetry((_) {
      calls++;
      throw StateError('logger unavailable');
    }, stateInput);
    expect(calls, 1);
  });

  test('invalid metadata is rejected before the sink boundary', () async {
    var calls = 0;
    await emitProtocolSyncTelemetry(
      (_) {
        calls++;
      },
      ProtocolSyncTelemetryInput(
        runtime: ProtocolSyncTelemetryRuntime.dart,
        kind: ProtocolSyncTelemetryKind.stateChanged,
        status: ProtocolSyncStatus.idle,
        timestamp: DateTime.parse('2026-08-11T17:53:28.151Z'),
        requestId: 'bad/id',
      ),
    );
    expect(calls, 0);
  });

  test('the sink receives an immutable privacy-bounded ORE record', () async {
    Map<String, Object>? received;
    await emitTelemetry((record) {
      received = record;
    }, stateInput);

    expect(received!['body'], 'opto-sync state changed');
    final attributes = received!['attributes']! as Map<String, Object>;
    expect(attributes['opto.sync.schema'], 'opto-sync.telemetry/v1');
    expect(received, isNot(contains('payload')));
    expect(received, isNot(contains('checkpoint')));
    expect(attributes, isNot(contains('payload')));
    expect(attributes, isNot(contains('checkpoint')));
    expect(() => received!['payload'] = 'secret', throwsUnsupportedError);
    expect(() => attributes['payload'] = 'secret', throwsUnsupportedError);
  });
}
