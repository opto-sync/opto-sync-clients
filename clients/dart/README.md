# opto_sync_client

Optimistic local-first writes for Dart and Flutter: a durable SQLite mutation
queue plus reconciliation through the shared [syncer.c](../../../syncer.c) merge
engine over `dart:ffi`.

Merge semantics are **not** reimplemented here — every conflict is resolved by
the same C core the TypeScript and Rust clients and all opto-sync servers use, so
one document reconciles identically on every tier. The contract is
[MERGE_SEMANTICS.md](../../../syncer.c/docs/MERGE_SEMANTICS.md).

## Install

```yaml
dependencies:
  opto_sync_client:
    path: ../../../opto-sync-clients/clients/dart
```

It needs the core shared library at runtime (the only binding that does). Build
it once:

```sh
cd syncer.c/core && mkdir -p build && cd build && cmake .. && make syncer
```

`FfiSyncer` locates it via `SYNCER_LIB_PATH`, falling back to a platform-specific
name (`libsyncer.dylib` / `libsyncer.so` / `syncer.dll`) in a given directory.

## Use

```dart
import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';

final db = OptoSyncDatabase(NativeDatabase(File('queue.sqlite')));
final client = OptoSyncClient(
  db: db,
  syncer: FfiSyncer(libraryPath: Platform.environment['SYNCER_LIB_PATH']!),
);

// Optimistic local write: persisted as pending, survives an app restart.
await client.queueMutation('todos', 'todo-1', {
  'title': 'buy milk',
  'updatedAt': '1721822400000',
});

// Reconcile a server payload against the local copy. A stale incoming record
// loses; a fresh one wins and deep-merges.
final merged = await client.reconcileIncoming('todos', 'todo-1', incoming, local);
```

Defaults match every other tier: `mergeByKey` on `id`, `resolveByTimestamp`,
LWW `updatedAt,syncedAt`, FWW `createdAt`. All are constructor-overridable.

Merge failure raises `SyncerMergeException` — it is never a silently empty
string.

## Queue

`OptoSyncDatabase.localMutations` is a Drift table (`targetTable`, `recordId`,
`jsonPayload`, `createdAt`, `syncStatus`). Query it with Drift directly; this
client exposes no `pendingMutations()` helper (the TypeScript client does — an
asymmetry noted in [OFFLINE_QUEUE.md](../../docs/OFFLINE_QUEUE.md)).

Durability is tested against a real file-backed database: queued payloads **and**
status transitions survive closing and reopening the connection.

There is **no built-in background flusher** — `queueMutation` calls an empty
`_triggerBackgroundSync()` hook. Transport and scheduling are yours; see
`opto-sync-e2e/test/clients/dart/` for a worked flush loop.

## Tests

```sh
dart pub get
dart test          # needs the core shared library (see Install)
```

## Docs

- [Getting started](../../docs/GETTING_STARTED.md)
- [Offline queue](../../docs/OFFLINE_QUEUE.md)
- [Reconciliation](../../docs/RECONCILIATION.md)
- [Merge semantics](../../../syncer.c/docs/MERGE_SEMANTICS.md)
