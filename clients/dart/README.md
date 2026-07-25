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
// `updatedAt` is stamped from the client's hybrid logical clock unless you
// supply one; `createdAt` is never stamped.
await client.queueMutation('todos', 'todo-1', {'title': 'buy milk'});

// When pulling server state, let the clock see the timestamps you received so
// the next local write is ordered after them.
await client.observeIncoming(incoming);

// Reconcile a server payload against the local copy. A stale incoming record
// loses; a fresh one wins and deep-merges.
final merged = await client.reconcileIncoming('todos', 'todo-1', incoming, local);
```

Defaults match every other tier: `mergeByKey` on `id`, `resolveByTimestamp`,
LWW `updatedAt,syncedAt`, and **no FWW keys**. All are constructor-overridable.

`createdAt` is deliberately *not* a default first-write-wins key. FWW is a
node-level veto, not field protection: if the incoming document's `createdAt` is
newer, the engine discards that whole node — so a replica holding a later
`createdAt` could never be written to again, silently. Pass
`FfiSyncer(fwwKeys: 'createdAt')` if you genuinely want first-writer-owns.

## Clock

`OptoSyncClient.clock()` lazily creates a `HybridLogicalClock` persisted in the
database's `meta` table (`hlc.nodeId`, `hlc.last`). The device id is generated
once per install and kept; the node id adds a per-instance suffix so two writers
over one database cannot issue identical timestamps.

`observe()` refuses a remote timestamp more than `defaultMaxDriftMs` (60s) ahead
of local time with a `ClockDriftException`, rather than adopting it — one broken
or hostile clock would otherwise poison every clock that syncs with it.

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
