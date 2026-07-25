import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

/// Locate the syncer.c core shared library robustly, independent of where the
/// test runner was started from: honor SYNCER_LIB_PATH, then walk up from the
/// current directory (and from the test script location as a fallback)
/// looking for `syncer.c/core/build/<platform lib>`.
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
  throw StateError(
      'Could not locate syncer.c/core/build/<libsyncer> above ${starts.join(' or ')}. '
      'Build the core or set SYNCER_LIB_PATH.');
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
    client = OptoSyncClient(db: db, syncer: syncer);
  });

  tearDown(() async {
    await db.close();
  });

  test('native core is loaded and reports a version', () {
    expect(syncer.nativeVersion, matches(RegExp(r'^\d+\.\d+\.\d+$')));
  });

  test('queueMutation persists the mutation with pending status', () async {
    await client.queueMutation('todos', 'todo-1', {
      'id': 'todo-1',
      'title': 'buy milk',
      'updatedAt': '2026-07-24T10:00:00Z',
    });

    final rows = await db.select(db.localMutations).get();
    expect(rows, hasLength(1));
    final row = rows.single;
    expect(row.targetTable, 'todos');
    expect(row.recordId, 'todo-1');
    expect(row.jsonPayload, contains('"title":"buy milk"'));
    expect(row.syncStatus, SyncStatus.pending);
    expect(row.createdAt, isNotNull);
  });

  test('queued mutations survive closing and reopening the database',
      () async {
    // The point of an optimistic local-first queue is that a write survives
    // the app being killed before it reaches the server. An in-memory database
    // cannot demonstrate that, so this test uses a real file and reopens it
    // through a brand-new connection.
    final dir = await Directory.systemTemp.createTemp('opto_sync_durability');
    final file = File('${dir.path}/queue.sqlite');
    try {
      final firstDb = OptoSyncDatabase(NativeDatabase(file));
      final firstClient = OptoSyncClient(db: firstDb, syncer: syncer);
      await firstClient.queueMutation('todos', 'todo-durable', {
        'id': 'todo-durable',
        'title': 'survive a restart',
        'updatedAt': '2026-07-24T10:00:00Z',
      });
      await firstClient.queueMutation('todos', 'todo-durable-2', {
        'id': 'todo-durable-2',
        'title': 'also survive',
      });
      await firstDb.close(); // simulates process exit

      expect(await file.exists(), isTrue, reason: 'queue must be on disk');
      expect(await file.length(), greaterThan(0));

      // A fresh connection over the same file — as a relaunched app would do.
      final reopenedDb = OptoSyncDatabase(NativeDatabase(file));
      addTearDown(reopenedDb.close);
      final rows = await reopenedDb.select(reopenedDb.localMutations).get();

      expect(rows, hasLength(2), reason: 'both pending writes must be recovered');
      expect(rows.map((r) => r.recordId),
          containsAll(<String>['todo-durable', 'todo-durable-2']));
      expect(rows.every((r) => r.syncStatus == SyncStatus.pending), isTrue,
          reason: 'recovered writes are still pending, not silently marked synced');
      expect(rows.first.jsonPayload, contains('survive a restart'));

      // A status transition must also be durable, otherwise a relaunch would
      // re-send work the server already accepted.
      await (reopenedDb.update(reopenedDb.localMutations)
            ..where((t) => t.recordId.equals('todo-durable')))
          .write(LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)));
      await reopenedDb.close();

      final thirdDb = OptoSyncDatabase(NativeDatabase(file));
      addTearDown(thirdDb.close);
      final after = await thirdDb.select(thirdDb.localMutations).get();
      final synced = after.where((r) => r.syncStatus == SyncStatus.synced);
      final pending = after.where((r) => r.syncStatus == SyncStatus.pending);
      expect(synced.map((r) => r.recordId), ['todo-durable']);
      expect(pending.map((r) => r.recordId), ['todo-durable-2']);
    } finally {
      await dir.delete(recursive: true);
    }
  });

  test('reconcileIncoming: stale incoming (older updatedAt) keeps base',
      () async {
    final base = {
      'id': 'todo-1',
      'title': 'local edit',
      'updatedAt': '2026-07-24T10:00:00Z',
    };
    final staleIncoming = {
      'id': 'todo-1',
      'title': 'old server copy',
      'updatedAt': '2026-07-20T08:00:00Z',
    };

    final merged =
        await client.reconcileIncoming('todos', 'todo-1', staleIncoming, base);
    expect(merged['title'], 'local edit');
    expect(merged['updatedAt'], '2026-07-24T10:00:00Z');
  });

  test('reconcileIncoming: fresh incoming (newer updatedAt) wins', () async {
    final base = {
      'id': 'todo-1',
      'title': 'local edit',
      'updatedAt': '2026-07-20T08:00:00Z',
    };
    final freshIncoming = {
      'id': 'todo-1',
      'title': 'newer server edit',
      'updatedAt': '2026-07-24T10:00:00Z',
    };

    final merged =
        await client.reconcileIncoming('todos', 'todo-1', freshIncoming, base);
    expect(merged['title'], 'newer server edit');
    expect(merged['updatedAt'], '2026-07-24T10:00:00Z');
  });

  test('reconcileIncoming: mergeByKey reconciles array-of-objects field by id',
      () async {
    final base = {
      'id': 'list-1',
      'items': [
        {'id': 1, 'text': 'alpha', 'done': false},
        {'id': 2, 'text': 'beta', 'done': false},
      ],
    };
    final incoming = {
      'id': 'list-1',
      'items': [
        {'id': 2, 'done': true},
        {'id': 3, 'text': 'gamma', 'done': false},
      ],
    };

    final merged =
        await client.reconcileIncoming('lists', 'list-1', incoming, base);
    final items = (merged['items'] as List).cast<Map<String, dynamic>>();
    expect(items, hasLength(3));

    Map<String, dynamic> byId(Object id) =>
        items.firstWhere((e) => '${e['id']}' == '$id');
    // Matched pair deep-merged: text kept from base, done updated by incoming.
    expect(byId(1)['text'], 'alpha');
    expect(byId(2)['text'], 'beta');
    expect(byId(2)['done'], true);
    // Unmatched incoming element appended.
    expect(byId(3)['text'], 'gamma');
  });

  test('default policy has no first-write-wins keys', () {
    // Pins the default. FWW is a node-level veto, so shipping `createdAt` here
    // silently made whole records unwritable.
    expect(syncer.lwwKeys, 'updatedAt,syncedAt');
    expect(syncer.fwwKeys, isNull,
        reason: 'createdAt must not be a default FWW key');
  });

  test('REGRESSION: a later createdAt no longer vetoes a newer write',
      () async {
    // With `createdAt` in fwwKeys the engine discarded this entire incoming
    // node — the vastly newer write vanished, silently, with a successful
    // merge, and any replica holding a later createdAt could never write to
    // the record again. Two devices creating the same id offline guarantees it.
    final base = {'createdAt': 100, 'updatedAt': 100, 'v': 'base'};
    final incoming = {'createdAt': 200, 'updatedAt': 999999, 'v': 'NEWEST'};

    final merged =
        await client.reconcileIncoming('records', 'r1', incoming, base);
    expect(merged['v'], 'NEWEST',
        reason: 'the newer write must land, not be thrown away');
    expect(merged['updatedAt'], 999999);
  });

  test('createdAt still merges through when the record has none', () async {
    // Dropping the veto must not lose the field.
    final merged = await client.reconcileIncoming(
      'records',
      'r1',
      {'id': 'r1', 'createdAt': 50, 'updatedAt': 200},
      {'id': 'r1', 'updatedAt': 100},
    );
    expect(merged['createdAt'], 50);
  });

  test('first-write-wins is still available when asked for', () async {
    // The capability is intact — it is just no longer the default.
    final fww = FfiSyncer(libraryPath: locateCoreLibrary(), fwwKeys: 'createdAt');
    final strict = OptoSyncClient(db: db, syncer: fww);
    final merged = await strict.reconcileIncoming(
      'accounts',
      'acct-1',
      {'id': 'acct-1', 'owner': 'impostor', 'createdAt': '2026-07-01T00:00:00Z'},
      {
        'id': 'acct-1',
        'owner': 'original-owner',
        'createdAt': '2026-01-01T00:00:00Z'
      },
    );
    expect(merged['owner'], 'original-owner');
    expect(merged['createdAt'], '2026-01-01T00:00:00Z');
  });

  test('merge failure surfaces as SyncerMergeException, not empty string', () {
    expect(() => syncer.merge('{not valid json', '{}'),
        throwsA(isA<SyncerMergeException>()));
  });
}
