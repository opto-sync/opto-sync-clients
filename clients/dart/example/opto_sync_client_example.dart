import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';

/// Minimal end-to-end example: queue an optimistic local mutation, then
/// reconcile an incoming server payload through the native syncer.c core.
///
/// The native library is resolved via the SYNCER_LIB_PATH environment
/// variable, falling back to the repo-relative core build output.
Future<void> main() async {
  final db = OptoSyncDatabase(NativeDatabase.memory());
  final syncer = FfiSyncer(
    libraryPath: resolveSyncerLibraryPath(
        directory: '../../../syncer.c/core/build'),
    // Defaults already encode the opto-sync policy; shown here explicitly.
    // Note fwwKeys is deliberately absent: first-write-wins is a node-level
    // veto, so a default `createdAt` made records permanently unwritable.
    resolveByTimestamp: true,
    lwwKeys: 'updatedAt,syncedAt',
    arrayStrategy: ArrayMergeStrategy.mergeByKey,
    arrayMatchKeys: 'id',
  );
  final client = OptoSyncClient(db: db, syncer: syncer);

  print('syncer core version: ${syncer.nativeVersion}');
  print('client id: ${await client.clientId()}');

  // 1. Optimistic local write, queued as pending. No `updatedAt` supplied, so
  //    the client stamps one from its hybrid logical clock.
  await client.queueMutation('todos', 'todo-1', {
    'id': 'todo-1',
    'title': 'water the plants',
  });
  final pending = await db.select(db.localMutations).get();
  print('queued mutations: ${pending.length} (status ${pending.first.syncStatus})');
  print('stamped payload: ${pending.first.jsonPayload}');

  // 2. A stale server copy arrives - LWW keeps the newer local edit.
  final merged = await client.reconcileIncoming(
    'todos',
    'todo-1',
    {'id': 'todo-1', 'title': 'old title', 'updatedAt': '2026-07-20T08:00:00Z'},
    {'id': 'todo-1', 'title': 'water the plants', 'updatedAt': '2026-07-24T10:00:00Z'},
  );
  print('reconciled title: ${merged['title']}');

  await db.close();
}
