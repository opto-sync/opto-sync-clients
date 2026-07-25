import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:sqlite3/sqlite3.dart' show sqlite3;
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

  /* ---------------------------------------------------------------------- */
  /* Clock stamping                                                         */
  /* ---------------------------------------------------------------------- */

  Future<Map<String, dynamic>> onlyQueuedPayload(OptoSyncDatabase target) async {
    final rows = await target.select(target.localMutations).get();
    expect(rows, hasLength(1));
    return jsonDecode(rows.single.jsonPayload) as Map<String, dynamic>;
  }

  test('queueMutation stamps updatedAt from the hybrid logical clock',
      () async {
    // The actual bug this fixes: an unstamped payload leaves last-write-wins at
    // the mercy of raw device clocks, and because the C core compares non-digit
    // strings lexicographically an ISO-8601 writer beats an HLC writer on every
    // conflict until 2286.
    final stamping = OptoSyncClient(
        db: db, syncer: syncer, now: () => 1721822400000);
    await stamping.queueMutation('todos', 'todo-1', {'title': 'no timestamp'});

    final payload = await onlyQueuedPayload(db);
    final stamp = payload['updatedAt'] as String;
    expect(parseHlc(stamp), isNotNull,
        reason: 'the stamp must be a parseable HLC: $stamp');
    expect(parseHlc(stamp)!.millis, 1721822400000);
    expect(stamp, startsWith('1721822400000-0000-'));
    expect(payload['title'], 'no timestamp',
        reason: 'other fields must survive stamping');
  });

  test('queueMutation does not overwrite a caller-supplied updatedAt',
      () async {
    await client.queueMutation('todos', 'todo-1', {
      'title': 'buy milk',
      'updatedAt': '2026-07-24T10:00:00Z',
    });
    expect((await onlyQueuedPayload(db))['updatedAt'], '2026-07-24T10:00:00Z');
  });

  test('queueMutation never stamps createdAt', () async {
    // createdAt belongs to whoever created the record; inventing one only
    // manufactures conflicts.
    await client.queueMutation('todos', 'todo-1', {'title': 'x'});
    expect((await onlyQueuedPayload(db)).containsKey('createdAt'), isFalse);
  });

  test('stampUpdatedAt: false queues the payload untouched', () async {
    final plain =
        OptoSyncClient(db: db, syncer: syncer, stampUpdatedAt: false);
    await plain.queueMutation('todos', 'todo-1', {'title': 'x'});
    expect((await onlyQueuedPayload(db)).containsKey('updatedAt'), isFalse);
  });

  test('the node id is per-instance, so two clients over one database never tie',
      () async {
    // Regression guard: a purely persisted node id would let two writers
    // sharing this database read the same clock state and issue *identical*
    // timestamps — the exact tie the node id exists to prevent.
    final a = OptoSyncClient(db: db, syncer: syncer);
    final b = OptoSyncClient(db: db, syncer: syncer);
    expect(await a.clientId(), isNot(equals(await b.clientId())));

    final stamps = <String>{};
    for (var i = 0; i < 20; i++) {
      stamps.add(await (await a.clock()).next());
      stamps.add(await (await b.clock()).next());
    }
    expect(stamps, hasLength(40));
  });

  test('the device id is persisted, so a restart keeps one identity', () async {
    final dir = await Directory.systemTemp.createTemp('opto_sync_device_id');
    final file = File('${dir.path}/queue.sqlite');
    try {
      final firstDb = OptoSyncDatabase(NativeDatabase(file));
      final firstId = await OptoSyncClient(db: firstDb, syncer: syncer).clientId();
      await firstDb.close();

      final secondDb = OptoSyncDatabase(NativeDatabase(file));
      addTearDown(secondDb.close);
      final secondId =
          await OptoSyncClient(db: secondDb, syncer: syncer).clientId();

      expect(secondId.split('.').first, firstId.split('.').first,
          reason: 'the device id must survive; regenerating it loses '
              'tie-breaking against this client\'s own past writes');
      expect(secondId, isNot(equals(firstId)),
          reason: 'the per-instance suffix is still fresh');
    } finally {
      await dir.delete(recursive: true);
    }
  });

  test('observeIncoming advances the clock past nested remote timestamps',
      () async {
    // A pull returns collections, not one flat record, so a top-level-only walk
    // would leave the clock behind timestamps it has already seen.
    final local =
        OptoSyncClient(db: db, syncer: syncer, now: () => 1721822400000);
    const remote = '1721822405000-00ff-peer';
    await local.observeIncoming({
      'rows': [
        {'id': 'a', 'updatedAt': remote}
      ]
    });

    await local.queueMutation('todos', 'a', {'v': 1});
    final stamp = (await onlyQueuedPayload(db))['updatedAt'] as String;
    expect(compareHlc(stamp, remote), greaterThan(0),
        reason: '$stamp must outrank observed $remote');
  });

  test('observeIncoming refuses an implausible peer timestamp', () async {
    // Bounded trust end to end: one peer with a broken clock must not drag this
    // client into the future, or every honest write here loses forever.
    const wall = 1721822400000;
    final local = OptoSyncClient(db: db, syncer: syncer, now: () => wall);
    final poisoned = '${wall + defaultMaxDriftMs + 60000}-0000-evil';

    await expectLater(
        local.observeIncoming({'id': 'a', 'updatedAt': poisoned}),
        throwsA(isA<ClockDriftException>()));

    await local.queueMutation('todos', 'a', {'v': 1});
    final stamp = (await onlyQueuedPayload(db))['updatedAt'] as String;
    expect(compareHlc(stamp, poisoned), lessThan(0),
        reason: 'a refused timestamp must not be adopted');
  });

  test('observeIncoming ignores legacy timestamp scales', () async {
    final local =
        OptoSyncClient(db: db, syncer: syncer, now: () => 1721822400000);
    await local.observeIncoming({
      'a': {'updatedAt': '2026-07-25T00:00:00Z'},
      'b': {'updatedAt': 1721822400000},
    });
    expect((await local.clock()).peek().millis, 0,
        reason: 'must not adopt a scale it cannot compare');
  });

  test('THE POINT: stamped writes are ordered by the merge engine', () async {
    // Two clients whose wall clocks disagree still converge on the causally
    // later write — the end-to-end reason stamping exists.
    final fastDb = OptoSyncDatabase(NativeDatabase.memory());
    final slowDb = OptoSyncDatabase(NativeDatabase.memory());
    addTearDown(fastDb.close);
    addTearDown(slowDb.close);

    final fast = OptoSyncClient(
        db: fastDb, syncer: syncer, now: () => 1721822430000); // 30s ahead
    final slow =
        OptoSyncClient(db: slowDb, syncer: syncer, now: () => 1721822400000);

    await fast.queueMutation('todos', 'r1', {'id': 'r1', 'title': 'from fast'});
    final fastEdit = await onlyQueuedPayload(fastDb);

    // The slow device sees the fast write, then makes a genuinely later edit.
    await slow.observeIncoming(fastEdit);
    await slow.queueMutation('todos', 'r1', {'id': 'r1', 'title': 'from slow'});
    final slowEdit = await onlyQueuedPayload(slowDb);

    expect(
        (await client.reconcileIncoming('todos', 'r1', slowEdit, fastEdit))['title'],
        'from slow');
    expect(
        (await client.reconcileIncoming('todos', 'r1', fastEdit, slowEdit))['title'],
        'from slow');
  });

  /* ---------------------------------------------------------------------- */
  /* Schema migration                                                       */
  /* ---------------------------------------------------------------------- */

  test('the v1 -> v2 migration preserves queued mutations', () async {
    // Adding the `meta` table must never cost a user their un-synced work.
    // Silently dropping the queue is the failure mode this guards.
    final dir = await Directory.systemTemp.createTemp('opto_sync_migration');
    final file = File('${dir.path}/queue.sqlite');
    try {
      // Build a faithful v1 database: drift's own DDL for local_mutations, no
      // `meta` table, user_version = 1.
      final seedDb = OptoSyncDatabase(NativeDatabase(file));
      final seedClient = OptoSyncClient(db: seedDb, syncer: syncer);
      await seedClient
          .queueMutation('todos', 'todo-v1', {'title': 'queued before upgrade'});
      await seedClient.queueMutation('todos', 'todo-v1b', {'title': 'also queued'});
      await seedDb.close();

      final raw = sqlite3.open(file.path);
      raw.execute('DROP TABLE meta;');
      raw.execute('PRAGMA user_version = 1;');
      expect(raw.select("SELECT name FROM sqlite_master WHERE name='meta'"),
          isEmpty);
      raw.dispose();

      // Reopen at v2 — drift runs onUpgrade.
      final upgradedDb = OptoSyncDatabase(NativeDatabase(file));
      addTearDown(upgradedDb.close);
      final rows = await upgradedDb.select(upgradedDb.localMutations).get();

      expect(rows, hasLength(2),
          reason: 'queued mutations must survive the migration');
      expect(rows.map((r) => r.recordId),
          containsAll(<String>['todo-v1', 'todo-v1b']));
      expect(rows.every((r) => r.syncStatus == SyncStatus.pending), isTrue,
          reason: 'and must still be pending, not silently marked synced');
      expect(rows.first.jsonPayload, contains('queued before upgrade'));

      // The new table is usable, and the clock works on the upgraded database.
      final upgraded = OptoSyncClient(db: upgradedDb, syncer: syncer);
      expect(await upgraded.clientId(), isNotEmpty);
      await upgraded.queueMutation('todos', 'todo-v2', {'title': 'after upgrade'});
      final after = await (upgradedDb.select(upgradedDb.localMutations)
            ..where((t) => t.recordId.equals('todo-v2')))
          .getSingle();
      expect(jsonDecode(after.jsonPayload)['updatedAt'], isA<String>());
    } finally {
      await dir.delete(recursive: true);
    }
  });
}
