import 'package:opto_sync_client/telemetry.dart';
import 'package:opto_sync_client/opto_sync_client.dart'
    show ProtocolSyncCycleResult;
import 'package:test/test.dart';

const cycleResult = ProtocolSyncCycleResult(
  pushedMutations: 2,
  acknowledgedMutations: 2,
  pulledChanges: 1,
  installedSnapshots: 0,
  checkpoint: '9',
  hasMorePending: false,
);

final class _HandWrittenTelemetryEvent implements TelemetryEvent {
  const _HandWrittenTelemetryEvent(this.fields);

  @override
  final TelemetryFields fields;

  @override
  int get schemaVersion => telemetrySchemaVersion;

  @override
  String get name => 'opto_sync.sync.cycle_succeeded';

  @override
  TelemetryLevel get level => TelemetryLevel.info;

  @override
  Map<String, Object> toJson() => <String, Object>{
    'schemaVersion': schemaVersion,
    'name': name,
    'level': level.name,
    'fields': fields.toJson(),
  };
}

final class _PayloadFields extends TelemetryFields {
  const _PayloadFields() : super(checkpoint: '9');

  @override
  Map<String, Object> toJson() => <String, Object>{
    'checkpoint': '9',
    'payload': <String, Object>{'private': true},
    'token': 'secret',
  };
}

void main() {
  test(
    'a failing telemetry sink cannot change a successful sync result',
    () async {
      var calls = 0;
      final actual = await observeSyncCycle((_) {
        calls++;
        throw StateError('logger unavailable');
      }, () async => cycleResult);

      expect(actual, same(cycleResult));
      expect(calls, 2);
    },
  );

  test(
    'a failing telemetry sink cannot replace the original sync error',
    () async {
      final original = StateError('authoritative failure');
      await expectLater(
        observeSyncCycle((_) {
          throw StateError('logger unavailable');
        }, () async => throw original),
        throwsA(same(original)),
      );
    },
  );

  test('the closed event fields contain no sensitive payload slot', () {
    final event = createTelemetryEvent(
      'opto_sync.sync.cycle_succeeded',
      TelemetryLevel.info,
      const TelemetryFields(checkpoint: '9'),
    );
    expect(event.toJson()['fields'], {'checkpoint': '9'});
    expect(event.toJson()['fields'], isNot(contains('payload')));
    expect(event.toJson()['fields'], isNot(contains('token')));
    expect(event.toJson()['fields'], isNot(contains('request')));
    expect(event.toJson()['fields'], isNot(contains('response')));
  });

  test('the factory copies fields before an overridden toJson can emit', () {
    final event = createTelemetryEvent(
      'opto_sync.sync.cycle_succeeded',
      TelemetryLevel.info,
      const _PayloadFields(),
    );
    expect(event.fields.runtimeType, TelemetryFields);
    expect(event.toJson()['fields'], {'checkpoint': '9'});
  });

  test('the event factory enforces canonical field constraints', () {
    expect(
      () => createTelemetryEvent(
        'opto_sync.sync.cycle_succeeded',
        TelemetryLevel.info,
        const TelemetryFields(checkpoint: '09'),
      ),
      throwsArgumentError,
    );
    expect(
      () => createTelemetryEvent(
        'opto_sync.sync.cycle_failed',
        TelemetryLevel.error,
        const TelemetryFields(code: 'contains-sensitive-text'),
      ),
      throwsArgumentError,
    );
    expect(
      () => createTelemetryEvent(
        'opto_sync.sync.cycle_succeeded',
        TelemetryLevel.info,
        const TelemetryFields(pulledChanges: -1),
      ),
      throwsArgumentError,
    );
  });

  test(
    'the final sink boundary rejects a hand-written invalid event',
    () async {
      var calls = 0;
      await emitTelemetry((_) {
        calls++;
      }, const _HandWrittenTelemetryEvent(TelemetryFields(checkpoint: '09')));
      expect(calls, 0);
    },
  );

  test(
    'invalid result metadata cannot change the successful sync result',
    () async {
      const invalidResult = ProtocolSyncCycleResult(
        pushedMutations: 2,
        acknowledgedMutations: 2,
        pulledChanges: 1,
        installedSnapshots: 0,
        checkpoint: '09',
        hasMorePending: false,
      );
      var calls = 0;
      final actual = await observeSyncCycle((_) {
        calls++;
      }, () async => invalidResult);
      expect(actual, same(invalidResult));
      expect(calls, 1);
    },
  );
}
