import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show OrderingTerm, Value;
import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:sqlite3/sqlite3.dart' show Database, sqlite3;
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
    'Build the core or set SYNCER_LIB_PATH.',
  );
}

void _createLegacyQueue(
  Database raw, {
  required int version,
  String? deviceId,
}) {
  raw.execute('''
    CREATE TABLE local_mutations (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      json_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
      sync_status INTEGER NOT NULL DEFAULT 0
    );
  ''');
  raw.execute('''
    INSERT INTO local_mutations
      (id, table_name, record_id, json_payload, created_at, sync_status)
    VALUES
      (4, 'todos', 'pending-a', '{"title":"queued first"}', 1700000001, 0),
      (8, 'todos', 'synced-history', '{"title":"already synced"}', 1700000002, 1),
      (12, 'todos', 'failed-history', '{"title":"failed legacy"}', 1700000003, 2),
      (20, 'todos', 'pending-b', '{"title":"queued second"}', 1700000004, 0);
  ''');
  if (version >= 2) {
    raw.execute('''
      CREATE TABLE meta (
        "key" TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
    ''');
    if (deviceId != null) {
      raw.execute('INSERT INTO meta ("key", value) VALUES (?, ?)', [
        metaDeviceIdKey,
        deviceId,
      ]);
    }
  }
  raw.execute('PRAGMA user_version = $version;');
}

List<List<Object?>> _legacyQueueSnapshot(Database raw) {
  return raw
      .select('''
        SELECT id, table_name, record_id, json_payload, created_at, sync_status
        FROM local_mutations
        ORDER BY id ASC
      ''')
      .map(
        (row) => <Object?>[
          row['id'],
          row['table_name'],
          row['record_id'],
          row['json_payload'],
          (row['created_at'] as int) * 1000,
          row['sync_status'],
        ],
      )
      .toList(growable: false);
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

  test(
    'durable queue commits wake an attached sync loop without trusting it',
    () async {
      var wakeups = 0;
      final waking = OptoSyncClient(
        db: db,
        syncer: syncer,
        stampUpdatedAt: false,
        onMutationQueued: () => wakeups++,
      );
      await waking.queueMutation('docs', 'r1', {'value': 1});
      waking.setBackgroundSyncTrigger(() {
        wakeups++;
        throw StateError('a hint must not undo committed work');
      });
      await waking.queueDelete('docs', 'r2');

      expect(wakeups, 2);
      expect(await waking.pendingMutations(), hasLength(2));
    },
  );

  test(
    'SQLite optimistic rows and queue entries commit or roll back together',
    () async {
      await db.customStatement(
        'CREATE TABLE optimistic_records ('
        'record_key TEXT PRIMARY KEY, payload TEXT NOT NULL)',
      );
      var wakeups = 0;
      final atomic = OptoSyncClient(
        db: db,
        syncer: syncer,
        stampUpdatedAt: false,
        onMutationQueued: () => wakeups++,
      );

      await atomic.queueMutationAtomic('docs', 'r1', {'value': 1}, (
        payload,
      ) async {
        await db.customStatement(
          'INSERT INTO optimistic_records(record_key, payload) VALUES (?, ?)',
          ['docs/r1', jsonEncode(payload)],
        );
      });
      final committed = await db
          .customSelect(
            "SELECT payload FROM optimistic_records "
            "WHERE record_key = 'docs/r1'",
          )
          .getSingle();
      expect(jsonDecode(committed.read<String>('payload')), {'value': 1});
      expect(await atomic.pendingMutations(), hasLength(1));

      await expectLater(
        atomic.queueMutationAtomic('docs', 'rollback', {'value': 2}, (
          payload,
        ) async {
          await db.customStatement(
            'INSERT INTO optimistic_records(record_key, payload) VALUES (?, ?)',
            ['docs/rollback', jsonEncode(payload)],
          );
          throw StateError('injected optimistic write failure');
        }),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'message',
            'injected optimistic write failure',
          ),
        ),
      );
      final rolledBack = await db
          .customSelect(
            "SELECT payload FROM optimistic_records "
            "WHERE record_key = 'docs/rollback'",
          )
          .get();
      expect(rolledBack, isEmpty);
      expect(
        await atomic.pendingMutations(),
        hasLength(1),
        reason: 'failed application transaction must not leave pending intent',
      );

      await atomic.queueDeleteAtomic('docs', 'r1', () async {
        await db.customStatement(
          "DELETE FROM optimistic_records WHERE record_key = 'docs/r1'",
        );
      });
      expect(
        await db.customSelect('SELECT * FROM optimistic_records').get(),
        isEmpty,
      );
      final request = await atomic.protocolPushRequest();
      expect(
        (request['mutations'] as List)
            .map((mutation) => (mutation as Map)['mutationId'])
            .toList(),
        ['1', '2'],
        reason: 'rolled-back optimistic writes must not consume protocol ids',
      );
      expect(wakeups, 2, reason: 'only committed transactions wake the loop');
    },
  );

  test(
    'SQLite pull pages and snapshots commit with their checkpoints',
    () async {
      await db.customStatement(
        'CREATE TABLE authoritative_records ('
        'record_key TEXT PRIMARY KEY, payload TEXT NOT NULL)',
      );

      await client.commitPullPageAtomic('7', () async {
        await db.customStatement(
          'INSERT INTO authoritative_records(record_key, payload) '
          'VALUES (?, ?)',
          ['docs/r1', '{"value":1}'],
        );
      });
      expect(await client.pullCheckpoint(), '7');

      await expectLater(
        client.commitPullPageAtomic('8', () async {
          await db.customStatement(
            'INSERT INTO authoritative_records(record_key, payload) '
            'VALUES (?, ?)',
            ['docs/rollback', '{"value":2}'],
          );
          throw StateError('injected pull application failure');
        }),
        throwsA(isA<StateError>()),
      );
      expect(await client.pullCheckpoint(), '7');
      expect(
        await db
            .customSelect(
              "SELECT * FROM authoritative_records "
              "WHERE record_key = 'docs/rollback'",
            )
            .get(),
        isEmpty,
      );

      final snapshot = <String, dynamic>{
        'protocolVersion': 1,
        'checkpoint': '9',
        'records': [
          {
            'table': 'docs',
            'recordId': 'snapshot',
            'record': {'value': 9},
            'revision': '1',
          },
        ],
      };
      await client.installSnapshotAtomic(snapshot, (records) async {
        await db.customStatement('DELETE FROM authoritative_records');
        for (final record in records) {
          await db.customStatement(
            'INSERT INTO authoritative_records(record_key, payload) '
            'VALUES (?, ?)',
            [
              '${record['table']}/${record['recordId']}',
              jsonEncode(record['record']),
            ],
          );
        }
      });
      expect(await client.pullCheckpoint(), '9');
      expect(
        (await db.customSelect('SELECT * FROM authoritative_records').get())
            .single
            .read<String>('record_key'),
        'docs/snapshot',
      );

      await expectLater(
        client.installSnapshotAtomic({...snapshot, 'checkpoint': '10'}, (
          records,
        ) async {
          await db.customStatement('DELETE FROM authoritative_records');
          throw StateError('injected snapshot replacement failure');
        }),
        throwsA(isA<StateError>()),
      );
      expect(await client.pullCheckpoint(), '9');
      expect(
        (await db.customSelect('SELECT * FROM authoritative_records').get())
            .single
            .read<String>('record_key'),
        'docs/snapshot',
      );
    },
  );

  test('queue quotas refuse work before consuming mutation ids', () async {
    final bounded = OptoSyncClient(
      db: db,
      syncer: syncer,
      stampUpdatedAt: false,
      maxPendingMutations: 2,
      maxQueuedPayloadBytes: 32,
    );

    await expectLater(
      bounded.queueMutation('docs', 'large', {
        'text': 'this payload is intentionally too large',
      }),
      throwsA(
        isA<QueueQuotaException>().having(
          (error) => error.code,
          'code',
          'PAYLOAD_TOO_LARGE',
        ),
      ),
    );
    await bounded.queueMutation('docs', 'r1', {'v': 1});
    await bounded.queueMutation('docs', 'r2', {'v': 2});
    await expectLater(
      bounded.queueDelete('docs', 'r3'),
      throwsA(
        isA<QueueQuotaException>().having(
          (error) => error.code,
          'code',
          'QUEUE_FULL',
        ),
      ),
    );

    final request = await bounded.protocolPushRequest();
    expect(
      (request['mutations'] as List)
          .map((mutation) => (mutation as Map)['mutationId'])
          .toList(),
      ['1', '2'],
      reason: 'refused writes must not create gaps in the dedupe sequence',
    );
  });

  test('concurrent writers cannot race past the pending queue limit', () async {
    final bounded = OptoSyncClient(
      db: db,
      syncer: syncer,
      stampUpdatedAt: false,
      maxPendingMutations: 1,
    );
    Future<Object> capture(Future<int> operation) async {
      try {
        return await operation;
      } on Object catch (error) {
        return error;
      }
    }

    final results = await Future.wait<Object>([
      capture(bounded.queueMutation('docs', 'r1', {'v': 1})),
      capture(bounded.queueMutation('docs', 'r2', {'v': 2})),
    ]);

    expect(results.whereType<int>(), hasLength(1));
    expect(results.whereType<QueueQuotaException>().single.code, 'QUEUE_FULL');
    final request = await bounded.protocolPushRequest();
    final mutations = request['mutations'] as List;
    expect(mutations, hasLength(1));
    expect((mutations.single as Map)['mutationId'], '1');
  });

  test(
    'pruneConfirmed removes oldest history but never pending work',
    () async {
      final first = await client.queueDelete('docs', 'r1');
      final second = await client.queueDelete('docs', 'r2');
      await client.queueDelete('docs', 'r3');
      for (final id in [first, second]) {
        await (db.update(
          db.localMutations,
        )..where((table) => table.id.equals(id))).write(
          const LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)),
        );
      }

      expect(await client.pruneConfirmed(retain: 1), 1);
      final rows = await (db.select(
        db.localMutations,
      )..orderBy([(table) => OrderingTerm.asc(table.id)])).get();
      expect(rows.map((row) => row.recordId), ['r2', 'r3']);
      expect(rows.map((row) => row.syncStatus), [
        SyncStatus.synced,
        SyncStatus.pending,
      ]);
    },
  );

  test('queued mutations survive closing and reopening the database', () async {
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

      expect(
        rows,
        hasLength(2),
        reason: 'both pending writes must be recovered',
      );
      expect(
        rows.map((r) => r.recordId),
        containsAll(<String>['todo-durable', 'todo-durable-2']),
      );
      expect(
        rows.every((r) => r.syncStatus == SyncStatus.pending),
        isTrue,
        reason:
            'recovered writes are still pending, not silently marked synced',
      );
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

  test(
    'reconcileIncoming: stale incoming (older updatedAt) keeps base',
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

      final merged = await client.reconcileIncoming(
        'todos',
        'todo-1',
        staleIncoming,
        base,
      );
      expect(merged['title'], 'local edit');
      expect(merged['updatedAt'], '2026-07-24T10:00:00Z');
    },
  );

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

    final merged = await client.reconcileIncoming(
      'todos',
      'todo-1',
      freshIncoming,
      base,
    );
    expect(merged['title'], 'newer server edit');
    expect(merged['updatedAt'], '2026-07-24T10:00:00Z');
  });

  test(
    'reconcileIncoming: mergeByKey reconciles array-of-objects field by id',
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

      final merged = await client.reconcileIncoming(
        'lists',
        'list-1',
        incoming,
        base,
      );
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
    },
  );

  test('default policy has no first-write-wins keys', () {
    // Pins the default. FWW is a node-level veto, so shipping `createdAt` here
    // silently made whole records unwritable.
    expect(syncer.lwwKeys, 'updatedAt,syncedAt');
    expect(
      syncer.fwwKeys,
      isNull,
      reason: 'createdAt must not be a default FWW key',
    );
  });

  test('REGRESSION: a later createdAt no longer vetoes a newer write', () async {
    // With `createdAt` in fwwKeys the engine discarded this entire incoming
    // node — the vastly newer write vanished, silently, with a successful
    // merge, and any replica holding a later createdAt could never write to
    // the record again. Two devices creating the same id offline guarantees it.
    final base = {'createdAt': 100, 'updatedAt': 100, 'v': 'base'};
    final incoming = {'createdAt': 200, 'updatedAt': 999999, 'v': 'NEWEST'};

    final merged = await client.reconcileIncoming(
      'records',
      'r1',
      incoming,
      base,
    );
    expect(
      merged['v'],
      'NEWEST',
      reason: 'the newer write must land, not be thrown away',
    );
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
    final fww = FfiSyncer(
      libraryPath: locateCoreLibrary(),
      fwwKeys: 'createdAt',
    );
    final strict = OptoSyncClient(db: db, syncer: fww);
    final merged = await strict.reconcileIncoming(
      'accounts',
      'acct-1',
      {
        'id': 'acct-1',
        'owner': 'impostor',
        'createdAt': '2026-07-01T00:00:00Z',
      },
      {
        'id': 'acct-1',
        'owner': 'original-owner',
        'createdAt': '2026-01-01T00:00:00Z',
      },
    );
    expect(merged['owner'], 'original-owner');
    expect(merged['createdAt'], '2026-01-01T00:00:00Z');
  });

  test('merge failure surfaces as SyncerMergeException, not empty string', () {
    expect(
      () => syncer.merge('{not valid json', '{}'),
      throwsA(isA<SyncerMergeException>()),
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Clock stamping                                                         */
  /* ---------------------------------------------------------------------- */

  Future<Map<String, dynamic>> onlyQueuedPayload(
    OptoSyncDatabase target,
  ) async {
    final rows = await target.select(target.localMutations).get();
    expect(rows, hasLength(1));
    return jsonDecode(rows.single.jsonPayload) as Map<String, dynamic>;
  }

  test('queueMutation stamps updatedAt from the hybrid logical clock', () async {
    // The actual bug this fixes: an unstamped payload leaves last-write-wins at
    // the mercy of raw device clocks, and because the C core compares non-digit
    // strings lexicographically an ISO-8601 writer beats an HLC writer on every
    // conflict until 2286.
    final stamping = OptoSyncClient(
      db: db,
      syncer: syncer,
      now: () => 1721822400000,
    );
    await stamping.queueMutation('todos', 'todo-1', {'title': 'no timestamp'});

    final payload = await onlyQueuedPayload(db);
    final stamp = payload['updatedAt'] as String;
    expect(
      parseHlc(stamp),
      isNotNull,
      reason: 'the stamp must be a parseable HLC: $stamp',
    );
    expect(parseHlc(stamp)!.millis, 1721822400000);
    expect(stamp, startsWith('1721822400000-0000-'));
    expect(
      payload['title'],
      'no timestamp',
      reason: 'other fields must survive stamping',
    );
  });

  test(
    'queueMutation does not overwrite a caller-supplied updatedAt',
    () async {
      await client.queueMutation('todos', 'todo-1', {
        'title': 'buy milk',
        'updatedAt': '2026-07-24T10:00:00Z',
      });
      expect(
        (await onlyQueuedPayload(db))['updatedAt'],
        '2026-07-24T10:00:00Z',
      );
    },
  );

  test('queueMutation never stamps createdAt', () async {
    // createdAt belongs to whoever created the record; inventing one only
    // manufactures conflicts.
    await client.queueMutation('todos', 'todo-1', {'title': 'x'});
    expect((await onlyQueuedPayload(db)).containsKey('createdAt'), isFalse);
  });

  test('stampUpdatedAt: false queues the payload untouched', () async {
    final plain = OptoSyncClient(db: db, syncer: syncer, stampUpdatedAt: false);
    await plain.queueMutation('todos', 'todo-1', {'title': 'x'});
    expect((await onlyQueuedPayload(db)).containsKey('updatedAt'), isFalse);
  });

  test(
    'one database shares protocol identity but uses per-instance HLC identities',
    () async {
      // Regression guard: a purely persisted node id would let two writers
      // sharing this database read the same clock state and issue *identical*
      // timestamps — the exact tie the node id exists to prevent.
      final a = OptoSyncClient(db: db, syncer: syncer);
      final b = OptoSyncClient(db: db, syncer: syncer);
      final ids = await Future.wait([a.clientId(), b.clientId()]);
      expect(
        ids.first,
        equals(ids.last),
        reason: 'one queue must map to one server mutation ledger',
      );
      expect(
        (await a.clock()).nodeId,
        isNot(equals((await b.clock()).nodeId)),
        reason: 'clock suffixes still prevent equal timestamps',
      );

      final stamps = <String>{};
      for (var i = 0; i < 20; i++) {
        stamps.add(await (await a.clock()).next());
        stamps.add(await (await b.clock()).next());
      }
      expect(stamps, hasLength(40));
    },
  );

  test('the device id is persisted, so a restart keeps one identity', () async {
    final dir = await Directory.systemTemp.createTemp('opto_sync_device_id');
    final file = File('${dir.path}/queue.sqlite');
    try {
      final firstDb = OptoSyncDatabase(NativeDatabase(file));
      final firstId = await OptoSyncClient(
        db: firstDb,
        syncer: syncer,
      ).clientId();
      await firstDb.close();

      final secondDb = OptoSyncDatabase(NativeDatabase(file));
      addTearDown(secondDb.close);
      final secondId = await OptoSyncClient(
        db: secondDb,
        syncer: syncer,
      ).clientId();

      expect(
        secondId,
        firstId,
        reason: 'protocol identity must survive process restart',
      );
    } finally {
      await dir.delete(recursive: true);
    }
  });

  test(
    'observeIncoming advances the clock past nested remote timestamps',
    () async {
      // A pull returns collections, not one flat record, so a top-level-only walk
      // would leave the clock behind timestamps it has already seen.
      final local = OptoSyncClient(
        db: db,
        syncer: syncer,
        now: () => 1721822400000,
      );
      const remote = '1721822405000-00ff-peer';
      await local.observeIncoming({
        'rows': [
          {'id': 'a', 'updatedAt': remote},
        ],
      });

      await local.queueMutation('todos', 'a', {'v': 1});
      final stamp = (await onlyQueuedPayload(db))['updatedAt'] as String;
      expect(
        compareHlc(stamp, remote),
        greaterThan(0),
        reason: '$stamp must outrank observed $remote',
      );
    },
  );

  test(
    'observeIncoming follows nested JSON-Pointer timestamp selectors',
    () async {
      final local = OptoSyncClient(
        db: db,
        syncer: syncer,
        lwwKeys: '#/_sync/updatedAt',
        now: () => 1721822400000,
      );
      const poisoned = '9999999999999-00ff-peer';
      await expectLater(
        local.observeIncoming({
          'rows': [
            {
              'id': 'a',
              '_sync': {'updatedAt': poisoned},
            },
          ],
        }),
        throwsA(isA<ClockDriftException>()),
      );
    },
  );

  test('observeIncoming refuses an implausible peer timestamp', () async {
    // Bounded trust end to end: one peer with a broken clock must not drag this
    // client into the future, or every honest write here loses forever.
    const wall = 1721822400000;
    final local = OptoSyncClient(db: db, syncer: syncer, now: () => wall);
    final poisoned = '${wall + defaultMaxDriftMs + 60000}-0000-evil';

    await expectLater(
      local.observeIncoming({'id': 'a', 'updatedAt': poisoned}),
      throwsA(isA<ClockDriftException>()),
    );

    await local.queueMutation('todos', 'a', {'v': 1});
    final stamp = (await onlyQueuedPayload(db))['updatedAt'] as String;
    expect(
      compareHlc(stamp, poisoned),
      lessThan(0),
      reason: 'a refused timestamp must not be adopted',
    );
  });

  test('observeIncoming ignores legacy timestamp scales', () async {
    final local = OptoSyncClient(
      db: db,
      syncer: syncer,
      now: () => 1721822400000,
    );
    await local.observeIncoming({
      'a': {'updatedAt': '2026-07-25T00:00:00Z'},
      'b': {'updatedAt': 1721822400000},
    });
    expect(
      (await local.clock()).peek().millis,
      0,
      reason: 'must not adopt a scale it cannot compare',
    );
  });

  test('THE POINT: stamped writes are ordered by the merge engine', () async {
    // Two clients whose wall clocks disagree still converge on the causally
    // later write — the end-to-end reason stamping exists.
    final fastDb = OptoSyncDatabase(NativeDatabase.memory());
    final slowDb = OptoSyncDatabase(NativeDatabase.memory());
    addTearDown(fastDb.close);
    addTearDown(slowDb.close);

    final fast = OptoSyncClient(
      db: fastDb,
      syncer: syncer,
      now: () => 1721822430000,
    ); // 30s ahead
    final slow = OptoSyncClient(
      db: slowDb,
      syncer: syncer,
      now: () => 1721822400000,
    );

    await fast.queueMutation('todos', 'r1', {'id': 'r1', 'title': 'from fast'});
    final fastEdit = await onlyQueuedPayload(fastDb);

    // The slow device sees the fast write, then makes a genuinely later edit.
    await slow.observeIncoming(fastEdit);
    await slow.queueMutation('todos', 'r1', {'id': 'r1', 'title': 'from slow'});
    final slowEdit = await onlyQueuedPayload(slowDb);

    expect(
      (await client.reconcileIncoming(
        'todos',
        'r1',
        slowEdit,
        fastEdit,
      ))['title'],
      'from slow',
    );
    expect(
      (await client.reconcileIncoming(
        'todos',
        'r1',
        fastEdit,
        slowEdit,
      ))['title'],
      'from slow',
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Schema migration                                                       */
  /* ---------------------------------------------------------------------- */

  test(
    'v1/v2 -> v3 adopts pending protocol identity without changing legacy rows',
    () async {
      await db.close();
      final cases = <({int version, String? deviceId})>[
        (version: 1, deviceId: null),
        (version: 2, deviceId: null),
        (version: 2, deviceId: 'legacyV2Device'),
      ];

      for (final fixtureCase in cases) {
        final dir = await Directory.systemTemp.createTemp(
          'opto_sync_v${fixtureCase.version}_migration',
        );
        final file = File('${dir.path}/queue.sqlite');
        try {
          final raw = sqlite3.open(file.path);
          _createLegacyQueue(
            raw,
            version: fixtureCase.version,
            deviceId: fixtureCase.deviceId,
          );
          final before = _legacyQueueSnapshot(raw);
          raw.close();

          var upgradedDb = OptoSyncDatabase(NativeDatabase(file));
          var upgraded = OptoSyncClient(
            db: upgradedDb,
            syncer: syncer,
            stampUpdatedAt: false,
          );
          final rows = await (upgradedDb.select(
            upgradedDb.localMutations,
          )..orderBy([(t) => OrderingTerm.asc(t.id)])).get();

          expect(
            rows
                .map(
                  (row) => <Object?>[
                    row.id,
                    row.targetTable,
                    row.recordId,
                    row.jsonPayload,
                    row.createdAt.millisecondsSinceEpoch,
                    row.syncStatus,
                  ],
                )
                .toList(),
            before,
            reason:
                'migration must not delete, reorder, or rewrite legacy rows',
          );

          final pending = rows
              .where((row) => row.syncStatus == SyncStatus.pending)
              .toList();
          final historical = rows
              .where((row) => row.syncStatus != SyncStatus.pending)
              .toList();
          expect(pending.map((row) => row.id), [4, 20]);
          expect(pending.map((row) => row.mutationId), ['1', '2']);
          expect(pending.map((row) => row.clientId).toSet(), hasLength(1));
          expect(pending.first.clientId, isNotEmpty);
          expect(
            historical.every(
              (row) => row.clientId == null && row.mutationId == null,
            ),
            isTrue,
            reason: 'synced/failed history must not become sendable',
          );
          if (fixtureCase.deviceId != null) {
            expect(pending.first.clientId, fixtureCase.deviceId);
          }

          final requestBeforeClose = await upgraded.protocolPushRequest();
          expect(
            (requestBeforeClose['mutations'] as List)
                .map((mutation) => (mutation as Map)['mutationId'])
                .toList(),
            ['1', '2'],
          );
          expect(requestBeforeClose['clientId'], pending.first.clientId);
          await upgradedDb.close();

          // An ambiguous response loss and process restart must resend the
          // exact immutable request rather than minting replacement ids.
          upgradedDb = OptoSyncDatabase(NativeDatabase(file));
          upgraded = OptoSyncClient(
            db: upgradedDb,
            syncer: syncer,
            stampUpdatedAt: false,
          );
          final requestAfterReopen = await upgraded.protocolPushRequest();
          expect(
            jsonEncode(requestAfterReopen),
            jsonEncode(requestBeforeClose),
          );

          await upgraded.queueMutation('todos', 'after-upgrade', {
            'title': 'new work',
          });
          final newRow = await (upgradedDb.select(
            upgradedDb.localMutations,
          )..where((t) => t.recordId.equals('after-upgrade'))).getSingle();
          expect(newRow.mutationId, '3');
          final sequence = await (upgradedDb.select(
            upgradedDb.meta,
          )..where((t) => t.key.equals(metaMutationSequenceKey))).getSingle();
          expect(sequence.value, '3');
          await upgradedDb.close();
        } finally {
          await dir.delete(recursive: true);
        }
      }
    },
  );

  test(
    'interrupted v2 adoption rolls back schema, rows, and metadata',
    () async {
      await db.close();
      final dir = await Directory.systemTemp.createTemp(
        'opto_sync_interrupted_migration',
      );
      final source = File('${dir.path}/source-v2.sqlite');
      final interrupted = File('${dir.path}/interrupted-v2.sqlite');
      try {
        final sourceDb = sqlite3.open(source.path);
        _createLegacyQueue(sourceDb, version: 2);
        final before = _legacyQueueSnapshot(sourceDb);
        sourceDb.close();
        await source.copy(interrupted.path);

        final injected = sqlite3.open(interrupted.path);
        injected.execute('''
        CREATE TRIGGER fail_protocol_adoption
        BEFORE UPDATE ON local_mutations
        WHEN OLD.id = 20
        BEGIN
          SELECT RAISE(ABORT, 'injected protocol adoption failure');
        END;
      ''');
        injected.close();

        final failedDb = OptoSyncDatabase(NativeDatabase(interrupted));
        await expectLater(
          failedDb.select(failedDb.localMutations).get(),
          throwsA(anything),
        );
        await failedDb.close();

        final afterFailure = sqlite3.open(interrupted.path);
        expect(
          afterFailure.select('PRAGMA user_version').single['user_version'],
          2,
        );
        expect(
          afterFailure
              .select('PRAGMA table_info(local_mutations)')
              .map((row) => row['name']),
          isNot(contains('client_id')),
          reason: 'added columns must roll back with failed identity adoption',
        );
        expect(_legacyQueueSnapshot(afterFailure), before);
        expect(
          afterFailure.select(
            "SELECT value FROM meta WHERE key IN "
            "('$metaDeviceIdKey', '$metaMutationSequenceKey')",
          ),
          isEmpty,
          reason: 'no partial client identity or sequence may become visible',
        );
        afterFailure.execute('DROP TRIGGER fail_protocol_adoption');
        afterFailure.close();

        final recoveredDb = OptoSyncDatabase(NativeDatabase(interrupted));
        final recovered = OptoSyncClient(
          db: recoveredDb,
          syncer: syncer,
          stampUpdatedAt: false,
        );
        final recoveredRequest = await recovered.protocolPushRequest();
        expect(
          (recoveredRequest['mutations'] as List)
              .map((mutation) => (mutation as Map)['mutationId'])
              .toList(),
          ['1', '2'],
        );
        expect(recoveredRequest['clientId'], isNotEmpty);
        await recoveredDb.close();
      } finally {
        await dir.delete(recursive: true);
      }
    },
  );

  test('protocol request, acknowledgement, and checkpoint match v1', () async {
    await client.queueMutation(
      'docs',
      'r1',
      {'id': 'r1', 'title': 'draft'},
      baseRevision: '7',
      resurrect: true,
    );
    await client.queueDelete('docs', 'r2', baseRevision: '3');

    final request = await client.protocolPushRequest();
    expect(request['protocolVersion'], 1);
    expect(request['clientId'], await client.clientId());
    final mutations = (request['mutations'] as List)
        .cast<Map<String, dynamic>>();
    expect(mutations, hasLength(2));
    expect(mutations.first['mutationId'], '1');
    expect(mutations.first['operation'], 'upsert');
    expect(mutations.first['baseRevision'], '7');
    expect(mutations.first['resurrect'], true);
    expect(mutations.first['payload'], containsPair('title', 'draft'));
    expect(
      (mutations.first['payload'] as Map)['updatedAt'],
      isA<String>(),
      reason: 'the protocol carries the same HLC-stamped optimistic payload',
    );
    expect(mutations.last, {
      'mutationId': '2',
      'operation': 'delete',
      'table': 'docs',
      'recordId': 'r2',
      'baseRevision': '3',
    });

    expect(
      await client.acknowledgePush({
        'protocolVersion': 1,
        'clientId': await client.clientId(),
        'lastMutationId': '2',
        'checkpoint': '1',
        'results': [
          {'mutationId': '1', 'status': 'applied'},
          {
            'mutationId': '2',
            'status': 'rejected',
            'code': 'REVISION_CONFLICT',
          },
        ],
      }, request),
      2,
    );
    expect(
      await client.pendingMutations(),
      isEmpty,
      reason: 'a durable rejection advances the watermark too',
    );

    expect(await client.pullCheckpoint(), '0');
    await client.setPullCheckpoint('9007199254740993');
    expect(await client.pullCheckpoint(), '9007199254740993');
    expect(
      () => client.setPullCheckpoint('01'),
      throwsA(isA<FormatException>()),
    );
  });

  test(
    'acknowledgement cannot discard mutations outside the sent batch',
    () async {
      await client.queueMutation('docs', 'r1', {'value': 1});
      await client.queueMutation('docs', 'r2', {'value': 2});
      final request = await client.protocolPushRequest(limit: 1);
      await expectLater(
        client.acknowledgePush({
          'protocolVersion': 1,
          'clientId': await client.clientId(),
          'lastMutationId': '2',
          'checkpoint': '2',
          'results': [
            {'mutationId': '1', 'status': 'applied'},
            {'mutationId': '2', 'status': 'applied'},
          ],
        }, request),
        throwsA(isA<FormatException>()),
      );
      expect(await client.pendingMutations(), hasLength(2));
    },
  );

  test(
    'acknowledgement rejects a forged request that differs from durable rows',
    () async {
      await client.queueMutation('docs', 'r1', {
        'value': 'actually queued',
      }, baseRevision: '3');
      final request = await client.protocolPushRequest();
      final forged = jsonDecode(jsonEncode(request)) as Map<String, dynamic>;
      ((forged['mutations'] as List).first as Map<String, dynamic>)['payload'] =
          {'value': 'forged after send'};
      await expectLater(
        client.acknowledgePush({
          'protocolVersion': 1,
          'clientId': await client.clientId(),
          'lastMutationId': '1',
          'checkpoint': '1',
          'results': [
            {
              'mutationId': '1',
              'status': 'applied',
              'checkpoint': '1',
              'revision': '1',
            },
          ],
        }, forged),
        throwsA(isA<FormatException>()),
      );
      expect(await client.pendingMutations(), hasLength(1));
    },
  );

  test(
    'snapshot install advances only after replacement and preserves pending work',
    () async {
      await client.queueMutation('docs', 'local', {'title': 'optimistic'});
      final snapshot = <String, dynamic>{
        'protocolVersion': 1,
        'checkpoint': '42',
        'records': [
          {
            'table': 'docs',
            'recordId': 'r1',
            'record': {'id': 'r1', 'title': 'authoritative'},
            'revision': '7',
          },
        ],
      };

      await expectLater(
        client.installSnapshot(snapshot, (records) async {
          throw StateError('replacement interrupted');
        }),
        throwsStateError,
      );
      expect(await client.pullCheckpoint(), '0');
      expect(await client.pendingMutations(), hasLength(1));
      var malformedCalled = false;
      await expectLater(
        client.installSnapshot(
          {
            ...snapshot,
            'records': [
              {...(snapshot['records'] as List).single, 'revision': '01'},
            ],
          },
          (records) async {
            malformedCalled = true;
          },
        ),
        throwsA(isA<FormatException>()),
      );
      expect(malformedCalled, isFalse);

      List<Map<String, dynamic>>? installed;
      await client.installSnapshot(snapshot, (records) async {
        installed = records;
      });
      expect(installed, snapshot['records']);
      expect(await client.pullCheckpoint(), '42');
      expect(await client.pendingMutations(), hasLength(1));
    },
  );
}
