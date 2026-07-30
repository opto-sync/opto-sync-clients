import 'dart:async';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';
import 'package:rxdart/rxdart.dart';

final _identity = SyncSessionIdentity(
  sharedUserId: 'user-1',
  provider: 'supabase',
  providerTenant: 'project-a',
  providerSubject: 'subject-1',
  sessionId: 'session-a',
);

SyncRecordEvent<Map<String, Object?>> _event({
  required SyncSource source,
  required SyncRecordAuthority authority,
  required String revision,
  required String title,
  bool pending = false,
  SyncSessionIdentity? identity,
}) => SyncRecordEvent<Map<String, Object?>>(
  table: 'todos',
  recordId: 'todo-1',
  operation: 'upsert',
  payload: <String, Object?>{'title': title},
  revision: revision,
  source: source,
  authority: authority,
  pending: pending,
  sessionPartition: transportSessionKey(identity ?? _identity),
);

Future<void> _waitFor(bool Function() test) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (!test()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('self-test condition did not become true');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

final class _LocalWrite
    implements LocalDurableWrite<Map<String, Object?>, int> {
  _LocalWrite(this.calls);
  final List<String> calls;

  @override
  Future<void> commitAuthoritative(Map<String, Object?> value) async {
    calls.add('authoritative:${value['title']}');
  }

  @override
  Future<int> commitLocalAndQueue(Map<String, Object?> value) async {
    calls.add('local:${value['title']}');
    return 7;
  }
}

final class _RemoteWrite
    implements RemoteConfirmedWriter<Map<String, Object?>> {
  _RemoteWrite(this.calls);
  final List<String> calls;

  @override
  Future<Map<String, Object?>> write(Map<String, Object?> value) async {
    calls.add('remote:${value['title']}');
    return <String, Object?>{'title': '${value['title']}-server'};
  }
}

final class _SyncCycle implements ForegroundSyncCycle<String> {
  _SyncCycle(this.calls);
  final List<String> calls;

  @override
  void hint() => calls.add('hint');

  @override
  Future<String> syncNow() async {
    calls.add('sync');
    return 'landed';
  }
}

Future<void> _reactiveRecordTest() async {
  final sessions = BehaviorSubject<SyncSession>.seeded(
    AuthenticatedSyncSession(_identity),
  );
  final local = PublishSubject<SyncRecordEvent<Map<String, Object?>>>();
  final remote = PublishSubject<SyncRecordEvent<Map<String, Object?>>>();
  final controller = ReactiveRecordController<Map<String, Object?>>(
    sessions: sessions,
    table: 'todos',
    recordId: 'todo-1',
    sources: <SyncRecordSource<Map<String, Object?>>>[
      SyncRecordSource<Map<String, Object?>>(
        name: 'local',
        events: (_) => local,
      ),
      SyncRecordSource<Map<String, Object?>>(
        name: 'remote',
        events: (_) => remote,
      ),
    ],
  );
  final values = <String>[];
  final subscription = controller.stream.listen((snapshot) {
    values.add(snapshot.value?['title'] as String);
  });
  await controller.start();
  local.add(
    _event(
      source: SyncSource.local,
      authority: SyncRecordAuthority.localView,
      revision: 'local:1',
      title: 'optimistic',
      pending: true,
    ),
  );
  final server = _event(
    source: SyncSource.http,
    authority: SyncRecordAuthority.authoritative,
    revision: '7',
    title: 'server-old',
  );
  remote.add(server);
  remote.add(
    SyncRecordEvent<Map<String, Object?>>(
      table: server.table,
      recordId: server.recordId,
      operation: server.operation,
      payload: server.payload,
      revision: server.revision,
      source: SyncSource.websocket,
      authority: server.authority,
      sessionPartition: server.sessionPartition,
    ),
  );
  local.add(
    _event(
      source: SyncSource.local,
      authority: SyncRecordAuthority.localView,
      revision: 'ack:1',
      title: 'optimistic',
    ),
  );
  await _waitFor(() => values.length == 2);
  if (values.join(',') != 'optimistic,server-old') {
    throw StateError('unexpected reactive values: $values');
  }

  final rotated = SyncSessionIdentity(
    sharedUserId: _identity.sharedUserId,
    provider: _identity.provider,
    providerTenant: _identity.providerTenant,
    providerSubject: _identity.providerSubject,
    sessionId: 'session-b',
  );
  sessions.add(AuthenticatedSyncSession(rotated));
  remote.add(
    _event(
      source: SyncSource.http,
      authority: SyncRecordAuthority.authoritative,
      revision: '8',
      title: 'stale-session',
    ),
  );
  remote.add(
    _event(
      source: SyncSource.http,
      authority: SyncRecordAuthority.authoritative,
      revision: '9',
      title: 'rotated',
      identity: rotated,
    ),
  );
  await _waitFor(() => values.last == 'rotated');

  await subscription.cancel();
  await controller.dispose();
  await local.close();
  await remote.close();
  await sessions.close();
}

Future<void> _optimismTest() async {
  final calls = <String>[];
  final session = AuthenticatedSyncSession(_identity);
  final local = _LocalWrite(calls);
  final remote = _RemoteWrite(calls);
  final sync = _SyncCycle(calls);

  final queued = await writeWithOptimism<Map<String, Object?>, int, String>(
    strategy: SyncOptimism.localDurable,
    session: session,
    value: <String, Object?>{'title': 'offline'},
    local: local,
    remote: remote,
    sync: sync,
    wakeBackground: () => calls.add('wake'),
  );
  if (queued is! LocalQueuedWrite<Map<String, Object?>, int, String> ||
      queued.localResult != 7 ||
      calls.join(',') != 'local:offline,hint,wake') {
    throw StateError('local-durable strategy failed: $calls');
  }

  calls.clear();
  final confirmed =
      await writeWithOptimism<Map<String, Object?>, int, String>(
        strategy: SyncOptimism.remoteConfirmed,
        session: session,
        value: <String, Object?>{'title': 'online'},
        local: local,
        remote: remote,
        sync: sync,
      );
  if (confirmed is! RemoteConfirmedWrite<Map<String, Object?>, int, String> ||
      calls.join(',') != 'remote:online,authoritative:online-server') {
    throw StateError('remote-confirmed strategy failed: $calls');
  }
}

Future<void> _backgroundTest() async {
  var cycles = 0;
  final runner = BackgroundSyncRunner<int>(
    budget: const Duration(seconds: 2),
    syncOnce: (_) async {
      cycles += 1;
      await Future<void>.delayed(const Duration(milliseconds: 50));
      return cycles;
    },
  );
  final first = runner.runOnce();
  final second = runner.runOnce();
  if (!identical(first, second)) {
    throw StateError('background runner did not expose one in-flight Future');
  }
  if (await first != 1 || cycles != 1) {
    throw StateError('background runner executed more than once');
  }

  final local = PublishSubject<BackgroundWakeReason>();
  final remote = PublishSubject<BackgroundWakeReason>();
  final outcomes = createBackgroundSyncOutcomes<int>(
    wakeStreams: <Stream<BackgroundWakeReason>>[local, remote],
    runner: runner,
  );
  final received = <BackgroundSyncOutcome<int>>[];
  final subscription = outcomes.listen(received.add);
  local.add(BackgroundWakeReason.localMutation);
  remote.add(BackgroundWakeReason.remoteHint);
  await _waitFor(() => received.isNotEmpty);
  if (!received.single.ok || cycles != 2) {
    throw StateError('RxDart background wake fusion failed');
  }
  await subscription.cancel();
  await local.close();
  await remote.close();
}

Future<void> main() async {
  await _reactiveRecordTest();
  await _optimismTest();
  await _backgroundTest();
  print('RxDart reactive/session/optimism/background self-test passed');
}
