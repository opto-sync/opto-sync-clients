import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

final class _Queue implements ProtocolQueueAdapter {
  final List<Map<String, dynamic>> pending;
  String checkpoint = '0';

  _Queue([Iterable<Map<String, dynamic>> pending = const []])
    : pending = [...pending];

  @override
  Future<int> acknowledgePush(
    ProtocolJson response,
    ProtocolJson request,
  ) async {
    final count = pending.length;
    pending.clear();
    return count;
  }

  @override
  Future<void> installSnapshot(
    ProtocolJson snapshot,
    Future<void> Function(List<ProtocolJson> records) replaceAuthoritative,
  ) async {
    await replaceAuthoritative(const []);
    checkpoint = snapshot['checkpoint'] as String;
  }

  @override
  Future<String> pullCheckpoint() async => checkpoint;

  @override
  Future<ProtocolJson> protocolPushRequest({int limit = 100}) async => {
    'protocolVersion': 1,
    'clientId': 'mobile-device',
    'mutations': pending.take(limit).toList(growable: false),
  };

  @override
  Future<void> setPullCheckpoint(String next) async {
    checkpoint = next;
  }
}

final class _Transport implements ProtocolTransport {
  @override
  Future<ProtocolJson> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) async => {
    'protocolVersion': 1,
    'checkpoint': checkpoint,
    'changes': <Object?>[],
    'hasMore': false,
  };

  @override
  Future<ProtocolJson> push(
    ProtocolJson request,
    ProtocolCancellationToken cancellation,
  ) async {
    final mutations = request['mutations'] as List;
    final last = mutations.last as Map;
    return {
      'protocolVersion': 1,
      'clientId': request['clientId'],
      'lastMutationId': last['mutationId'],
      'checkpoint': '1',
      'results': [
        for (final raw in mutations)
          {'mutationId': (raw as Map)['mutationId'], 'status': 'applied'},
      ],
    };
  }

  @override
  Future<ProtocolJson> snapshot(
    ProtocolCancellationToken cancellation, [
    ProtocolJson? reset,
  ]) => throw StateError('snapshot not expected');
}

final class _Callbacks implements ProtocolSyncCallbacks {
  @override
  Future<void> applyChanges(List<ProtocolJson> changes) async {}

  @override
  Future<void> replaceAuthoritative(List<ProtocolJson> records) async {}
}

final class _SessionProvider implements SyncSessionProvider {
  final SyncSessionSnapshot snapshot;

  const _SessionProvider(this.snapshot);

  @override
  Stream<SyncSessionSnapshot> get changes => const Stream.empty();

  @override
  Future<SyncSessionSnapshot> current() async => snapshot;
}

void main() {
  test(
    'RxDart record stream merges sources, overlays local intent, and de-dupes',
    () async {
      final sqlite = StreamController<SyncRecordEnvelope>();
      final http = StreamController<SyncRecordEnvelope>();
      var pendingTitle = 'pending local';
      final records = createReactiveRecordStream(
        tableName: 'docs',
        recordId: 'r1',
        sources: [sqlite.stream, http.stream],
        reconcile: (incoming, existing) =>
            (incoming['updatedAt'] as int) >= (existing['updatedAt'] as int)
            ? {...existing, ...incoming}
            : {...incoming, ...existing},
        renderLocal: (authoritative) async => pendingTitle.isEmpty
            ? authoritative
            : {...authoritative, 'title': pendingTitle},
      );
      final result = records.take(2).toList();
      sqlite.add(
        SyncRecordEnvelope(
          tableName: 'docs',
          recordId: 'r1',
          source: ReactiveSyncSource.sqlite,
          record: {'id': 'r1', 'title': 'cached', 'updatedAt': 1},
        ),
      );
      http.add(
        SyncRecordEnvelope(
          tableName: 'docs',
          recordId: 'r1',
          source: ReactiveSyncSource.http,
          record: {'updatedAt': 1, 'title': 'cached', 'id': 'r1'},
        ),
      );
      await Future<void>.delayed(Duration.zero);
      pendingTitle = '';
      http.add(
        SyncRecordEnvelope(
          tableName: 'docs',
          recordId: 'r1',
          source: ReactiveSyncSource.http,
          record: {'id': 'r1', 'title': 'server', 'updatedAt': 2},
        ),
      );

      expect(await result, [
        {'id': 'r1', 'title': 'pending local', 'updatedAt': 1},
        {'id': 'r1', 'title': 'server', 'updatedAt': 2},
      ]);
      expect(
        canonicalReactiveJson({
          'z': 1,
          'nested': {'b': 2, 'a': 1},
        }),
        canonicalReactiveJson({
          'nested': {'a': 1, 'b': 2},
          'z': 1,
        }),
      );
      await sqlite.close();
      await http.close();
    },
  );

  test('RxDart replay resets when the final listener leaves', () async {
    final hints = StreamController<Object?>.broadcast();
    var loads = 0;
    final refreshed = createRemoteRefreshStream(
      hints.stream,
      () async => ++loads,
    );

    expect(await refreshed.first, 1);
    expect(loads, 1);
    expect(
      await refreshed.first,
      2,
      reason: 'a new listener must perform a fresh authoritative read',
    );
    expect(loads, 2);
    await hints.close();
  });

  test('optimism levels select remote-first or durable-local work', () async {
    final calls = <String>[];
    Future<String> remote() async {
      calls.add('remote');
      return 'server';
    }

    Future<int> local() async {
      calls.add('local');
      return 7;
    }

    final confirmed = await executeReactiveWrite(
      optimism: OptimismLevel.serverConfirmed,
      remoteWrite: remote,
      queueLocal: local,
      installRemote: (_) async => calls.add('install'),
    );
    expect(confirmed, isA<ServerConfirmedWrite<String, int>>());
    expect(calls, ['remote', 'install']);
    calls.clear();

    final optimistic = await executeReactiveWrite(
      optimism: OptimismLevel.durableLocalAndWait,
      remoteWrite: remote,
      queueLocal: local,
      requestBackgroundSync: () => calls.add('background'),
      syncNow: () async => calls.add('sync-now'),
    );
    expect(optimistic, isA<DurableLocalWrite<String, int>>());
    expect(calls, ['local', 'background', 'sync-now']);
  });

  test(
    'mobile runner reopens a loop and drains a bounded durable batch',
    () async {
      final queue = _Queue([
        {
          'mutationId': '1',
          'operation': 'upsert',
          'table': 'docs',
          'recordId': 'r1',
          'payload': {'id': 'r1'},
        },
      ]);
      final runner = MobileBackgroundSyncRunner(
        createLoop: () async =>
            ProtocolSyncLoop(queue, _Transport(), _Callbacks()),
        deadline: const Duration(seconds: 5),
      );
      final result = await runner.run();
      expect(result.outcome, BackgroundSyncOutcome.success);
      expect(result.cycles, 1);
      expect(result.pushedMutations, 1);
      expect(result.acknowledgedMutations, 1);
      expect(queue.pending, isEmpty);
    },
  );

  test('mobile runner reports cold-start failures as retryable work', () async {
    final runner = MobileBackgroundSyncRunner(
      createLoop: () async => throw StateError('SQLite unavailable'),
      deadline: const Duration(seconds: 1),
    );

    final result = await runner.run();
    expect(result.outcome, BackgroundSyncOutcome.retry);
    expect(result.cycles, 0);
    expect(result.error, isA<StateError>());
  });

  test('native TCP hints reconnect after an initial network failure', () async {
    final reservation = await ServerSocket.bind(
      InternetAddress.loopbackIPv4,
      0,
    );
    final port = reservation.port;
    await reservation.close();

    final firstFailure = Completer<void>();
    final firstHint = dartIoTcpSyncHints(
      InternetAddress.loopbackIPv4.address,
      port,
      secure: false,
      retryBase: const Duration(milliseconds: 5),
      retryMaximum: const Duration(milliseconds: 10),
      onError: (_, _) {
        if (!firstFailure.isCompleted) firstFailure.complete();
      },
    ).first.timeout(const Duration(seconds: 5));

    await firstFailure.future.timeout(const Duration(seconds: 2));
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, port);
    final serving = server.listen((socket) async => socket.close());
    try {
      expect(
        await firstHint,
        isEmpty,
        reason: 'a successful reconnect emits an HTTP-pull wake hint',
      );
    } finally {
      await server.close();
      await serving.cancel();
    }
  });

  test(
    'native HTTP transport sends auth and preserves decimal checkpoints',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final seen = <String, Object?>{};
      final serving = server.listen((request) async {
        seen['path'] = request.uri.path;
        seen['query'] = request.uri.queryParameters;
        seen['authorization'] = request.headers.value(
          HttpHeaders.authorizationHeader,
        );
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode({
            'protocolVersion': 1,
            'checkpoint': '9007199254740993',
            'changes': <Object?>[],
            'hasMore': false,
          }),
        );
        await request.response.close();
      });
      try {
        final transport = DartIoProtocolTransport(
          baseUri: Uri.parse('http://127.0.0.1:${server.port}/v1/'),
          headers: () => {'authorization': 'Bearer fresh-token'},
        );
        final response = await transport.pull(
          '9007199254740993',
          50,
          ProtocolCancellationToken(),
        );
        expect(response['checkpoint'], '9007199254740993');
        expect(seen, {
          'path': '/v1/pull',
          'query': {'checkpoint': '9007199254740993', 'limit': '50'},
          'authorization': 'Bearer fresh-token',
        });
      } finally {
        await server.close(force: true);
        await serving.cancel();
      }
    },
  );

  test('native HTTP transport preserves permanent session failures', () async {
    final transport = DartIoProtocolTransport(
      baseUri: Uri.parse('http://127.0.0.1:1/v1/'),
      headers: sessionAuthorizationHeaders(
        const _SessionProvider(
          SyncSessionSnapshot(
            status: SyncSessionStatus.anonymous,
            scope: 'anonymous',
          ),
        ),
      ),
    );

    await expectLater(
      transport.pull('0', 50, ProtocolCancellationToken()),
      throwsA(
        isA<SyncTransportException>()
            .having((error) => error.code, 'code', 'ANONYMOUS_SESSION')
            .having((error) => error.retryable, 'retryable', isFalse),
      ),
    );
  });

  test(
    'Supabase sessions scope SQLite and resolve fresh auth lazily',
    () async {
      String token(String sessionId) {
        final payload = base64Url
            .encode(utf8.encode(jsonEncode({'session_id': sessionId})))
            .replaceAll('=', '');
        return 'header.$payload.signature';
      }

      final changes = StreamController<SupabaseSessionData?>();
      var session = SupabaseSessionData(
        userId: 'user-a',
        accessToken: token('session-a'),
        expiresAt: 2000000000,
      );
      final provider = createSupabaseSessionProvider(
        getSession: () async => session,
        sessionChanges: changes.stream,
      );
      final initial = await provider.current();
      expect(initial.scope, 'user-a:session-a');
      final firstDatabase = sessionDatabaseName('app-sync', initial);
      expect(firstDatabase, matches(RegExp(r'^app-sync-[a-f0-9]{24}$')));
      expect(firstDatabase, isNot(contains('user-a')));

      session = SupabaseSessionData(
        userId: 'user-a',
        accessToken: token('session-b'),
        expiresAt: 2000000000,
      );
      final headers = await sessionAuthorizationHeaders(provider)();
      expect(headers['authorization'], 'Bearer ${session.accessToken}');
      final changed = provider.changes.first;
      changes.add(session);
      final next = await changed;
      expect(next.scope, 'user-a:session-b');
      expect(sessionDatabaseName('app-sync', next), isNot(firstDatabase));
      await changes.close();
    },
  );
}
