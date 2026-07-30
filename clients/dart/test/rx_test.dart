import 'dart:async';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:opto_sync_client/rx.dart' as rx;
import 'package:rxdart/rxdart.dart';
import 'package:test/test.dart';

String locateCoreLibrary() {
  final env = Platform.environment['SYNCER_LIB_PATH'];
  if (env != null && env.isNotEmpty) return env;
  final starts = <String>[
    Directory.current.absolute.path,
    File.fromUri(Platform.script).parent.absolute.path,
  ];
  for (final start in starts) {
    var dir = Directory(start);
    for (var i = 0; i < 10; i++) {
      final buildDir =
          '${dir.path}${Platform.pathSeparator}syncer.c${Platform.pathSeparator}core${Platform.pathSeparator}build';
      if (Directory(buildDir).existsSync()) {
        final path = resolveSyncerLibraryPath(directory: buildDir);
        if (File(path).existsSync()) return path;
      }
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
  }
  throw StateError('could not locate the syncer core library');
}

class _FakeLoop implements rx.SyncKicker {
  _FakeLoop(this.client, {this.acknowledge = true, this.fail = false});

  final OptoSyncClient client;
  final bool acknowledge;
  final bool fail;
  int hints = 0;
  int cycles = 0;

  @override
  void hint() => hints++;

  @override
  Future<ProtocolSyncCycleResult> syncNow() async {
    cycles++;
    if (fail) throw const SyncTransportException('sync failed');
    if (acknowledge) {
      final pending = await client.pendingMutations(limit: 1000);
      for (final row in pending) {
        await client.confirmSyncedUpTo(row.mutationId!, clientId: row.clientId);
      }
    }
    return const ProtocolSyncCycleResult(
      pushedMutations: 0,
      acknowledgedMutations: 0,
      pulledChanges: 0,
      installedSnapshots: 0,
      checkpoint: '0',
      hasMorePending: false,
    );
  }
}

void main() {
  late OptoSyncDatabase db;
  late FfiSyncer syncer;
  late OptoSyncClient client;

  setUpAll(() {
    syncer = FfiSyncer(libraryPath: locateCoreLibrary());
  });

  setUp(() {
    db = OptoSyncDatabase(NativeDatabase.memory());
    client = OptoSyncClient(
      db: db,
      syncer: syncer,
      overlaySyncer: syncer.overlay(),
    );
  });

  tearDown(() async {
    await db.close();
  });

  test('watchLocalView emits the optimistic view immediately after a write',
      () async {
    final authoritative = BehaviorSubject<Map<String, dynamic>?>.seeded({
      'id': 'r1',
      'title': 'server',
      'updatedAt': '100',
    });
    final emissions = <Map<String, dynamic>?>[];
    final sub = rx
        .watchLocalView(
          client: client,
          tableName: 'docs',
          recordId: 'r1',
          authoritative: authoritative,
        )
        .listen(emissions.add);

    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(emissions, hasLength(1));
    expect(emissions.single?['title'], 'server');

    await client.queueMutation('docs', 'r1', {
      'title': 'local edit',
      'updatedAt': '200',
    });
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(emissions.last?['title'], 'local edit');

    await sub.cancel();
    await authoritative.close();
  });

  test('watchLocalView deduplicates canonically identical states', () async {
    final authoritative = BehaviorSubject<Map<String, dynamic>?>.seeded({
      'id': 'r2',
      'n': 1,
    });
    final emissions = <Map<String, dynamic>?>[];
    final sub = rx
        .watchLocalView(
          client: client,
          tableName: 'docs',
          recordId: 'r2',
          authoritative: authoritative,
        )
        .listen(emissions.add);
    await Future<void>.delayed(const Duration(milliseconds: 100));

    // Same canonical state, different key order and object identity.
    authoritative.add({'n': 1, 'id': 'r2'});
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(emissions, hasLength(1));

    authoritative.add({'id': 'r2', 'n': 2});
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(emissions, hasLength(2));

    await sub.cancel();
    await authoritative.close();
  });

  test('background optimism resolves once durably queued, no sync kicked',
      () async {
    final loop = _FakeLoop(client);
    final receipt = await rx.write(
      client,
      'docs',
      'r3',
      {'v': 1},
      optimism: rx.Optimism.background,
      loop: loop,
    );
    expect(receipt.optimism, rx.Optimism.background);
    expect(loop.cycles, 0);
    expect(loop.hints, 0);
    expect(await client.pendingMutations(), hasLength(1));
  });

  test('localFirst optimism queues then kicks a cycle without awaiting',
      () async {
    final loop = _FakeLoop(client);
    final receipt = await rx.write(client, 'docs', 'r4', {'v': 1}, loop: loop);
    expect(receipt.optimism, rx.Optimism.localFirst);
    expect(loop.hints, 1);
    expect(loop.cycles, 0);
  });

  test('awaitServer optimism resolves only after acknowledgement', () async {
    final loop = _FakeLoop(client);
    await rx.write(
      client,
      'docs',
      'r5',
      {'v': 1},
      optimism: rx.Optimism.awaitServer,
      loop: loop,
    );
    expect(loop.cycles, greaterThanOrEqualTo(1));
    expect(await client.pendingMutations(), isEmpty);
  });

  test('awaitServer rejects when the server never acknowledges — data stays queued',
      () async {
    final loop = _FakeLoop(client, acknowledge: false);
    await expectLater(
      rx.write(
        client,
        'docs',
        'r6',
        {'v': 1},
        optimism: rx.Optimism.awaitServer,
        loop: loop,
      ),
      throwsStateError,
    );
    expect(await client.pendingMutations(), hasLength(1));
  });

  test('awaitServer without a loop is a usage error', () async {
    await expectLater(
      rx.write(client, 'docs', 'r7', {'v': 1}, optimism: rx.Optimism.awaitServer),
      throwsArgumentError,
    );
  });

  test('writeDelete follows the same optimism contract', () async {
    final loop = _FakeLoop(client);
    await rx.writeDelete(
      client,
      'docs',
      'r8',
      optimism: rx.Optimism.awaitServer,
      loop: loop,
    );
    expect(await client.pendingMutations(), isEmpty);
  });

  test('hasUnsyncedWorkStream tracks the pending queue', () async {
    final states = <bool>[];
    final sub = rx.hasUnsyncedWorkStream(client).listen(states.add);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    await client.queueMutation('docs', 'r9', {'v': 1});
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(states, [false, true]);
    await sub.cancel();
  });
}
