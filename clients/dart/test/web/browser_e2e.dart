import 'dart:convert';

import 'package:drift/drift.dart' show Variable;
import 'package:drift/wasm.dart' show WebStorageApi;
import 'package:opto_sync_client/web.dart';
import 'package:web/web.dart' as web;

Never _fail(String message) => throw StateError(message);

Future<void> main() async {
  try {
    final syncer = await WasmSyncer.load(
      moduleUri: Uri.parse('/syncer/index.mjs'),
    );
    if (syncer.wasmVersion != '0.2.1') {
      _fail('unexpected syncer.c version ${syncer.wasmVersion}');
    }
    final merged =
        jsonDecode(
              syncer.merge(
                '{"title":"local","updatedAt":2000,"nested":{"kept":true}}',
                '{"title":"stale","updatedAt":1000,"nested":{"lost":true}}',
              ),
            )
            as Map<String, dynamic>;
    if (merged['title'] != 'local' ||
        (merged['nested'] as Map<String, dynamic>)['lost'] != null) {
      _fail('WebAssembly timestamp merge diverged: $merged');
    }

    const databaseName = 'opto-dart-web-e2e';
    final opened = await openOptoSyncIndexedDb(
      databaseName: databaseName,
      sqlite3Uri: Uri.parse('/sqlite3.wasm'),
      driftWorkerUri: Uri.parse('/drift_worker.js'),
    );
    if (opened.storage.storageApi != WebStorageApi.indexedDb) {
      _fail('queue did not select IndexedDB: ${opened.storage}');
    }
    final db = opened.database;
    await db.customStatement(
      'CREATE TABLE IF NOT EXISTS authoritative_records ('
      'id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    );
    final client = OptoSyncClient(
      db: db,
      syncer: syncer,
      overlaySyncer: syncer.overlay(),
      stampUpdatedAt: false,
    );

    await client.queueMutationAtomic(
      'tasks',
      'committed',
      {'title': 'saved in IndexedDB', 'updatedAt': 2000},
      (payload) => db.customStatement(
        'INSERT INTO authoritative_records(id, data) VALUES (?, ?)',
        ['committed', jsonEncode(payload)],
      ),
      baseRevision: '0',
    );

    var rollbackObserved = false;
    try {
      await client.queueMutationAtomic(
        'tasks',
        'rolled-back',
        {'title': 'must disappear'},
        (payload) async {
          await db.customStatement(
            'INSERT INTO authoritative_records(id, data) VALUES (?, ?)',
            ['rolled-back', jsonEncode(payload)],
          );
          throw StateError('intentional IndexedDB rollback');
        },
      );
    } catch (error) {
      rollbackObserved = error.toString().contains(
        'intentional IndexedDB rollback',
      );
    }
    if (!rollbackObserved) _fail('atomic rollback did not surface');
    final rolledBack = await db
        .customSelect(
          'SELECT data FROM authoritative_records WHERE id = ?',
          variables: const [Variable<String>('rolled-back')],
        )
        .get();
    if (rolledBack.isNotEmpty) _fail('failed optimistic row survived');
    final requestBeforeClose = await client.protocolPushRequest();
    if (requestBeforeClose['mutations'] is! List ||
        (requestBeforeClose['mutations'] as List).length != 1 ||
        (requestBeforeClose['mutations'] as List).single['mutationId'] != '1') {
      _fail('rollback left a queue row or sequence gap: $requestBeforeClose');
    }

    await client.commitPullPageAtomic('7', () async {
      await db.customStatement(
        'INSERT INTO authoritative_records(id, data) VALUES (?, ?)',
        ['pulled', '{"fromServer":true}'],
      );
    });
    await opened.close();

    final reopened = await openOptoSyncIndexedDb(
      databaseName: databaseName,
      sqlite3Uri: Uri.parse('/sqlite3.wasm'),
      driftWorkerUri: Uri.parse('/drift_worker.js'),
    );
    final reopenedClient = OptoSyncClient(
      db: reopened.database,
      syncer: syncer,
      overlaySyncer: syncer.overlay(),
      stampUpdatedAt: false,
    );
    final recovered = await reopenedClient.pendingMutations();
    final committed = await reopened.database
        .customSelect(
          'SELECT data FROM authoritative_records WHERE id = ?',
          variables: const [Variable<String>('committed')],
        )
        .getSingle();
    final pulled = await reopened.database
        .customSelect(
          'SELECT data FROM authoritative_records WHERE id = ?',
          variables: const [Variable<String>('pulled')],
        )
        .getSingle();
    final checkpoint = await reopenedClient.pullCheckpoint();
    await reopened.close();

    web.document.body!.textContent = jsonEncode({
      'ok': true,
      'engineVersion': syncer.wasmVersion,
      'storage': opened.storage.name,
      'storageApi': opened.storage.storageApi?.name,
      'recoveredMutationIds': recovered.map((row) => row.mutationId).toList(),
      'recoveredPayload': jsonDecode(recovered.single.jsonPayload),
      'committed': jsonDecode(committed.read<String>('data')),
      'pulled': jsonDecode(pulled.read<String>('data')),
      'checkpoint': checkpoint,
      'rollbackObserved': rollbackObserved,
    });
  } catch (error, stackTrace) {
    web.document.body!.textContent = jsonEncode({
      'ok': false,
      'error': error.toString(),
      'stack': stackTrace.toString(),
    });
  }
}
