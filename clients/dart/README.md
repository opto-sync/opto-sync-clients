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
import 'dart:convert';
import 'dart:io';

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

// If the app row is in the same SQLite database, commit it with the queue:
await client.queueMutationAtomic('todos', 'todo-2', {'title': 'atomic'}, (
  payload,
) async {
  await db.customStatement(
    'INSERT OR REPLACE INTO todos(id, data) VALUES (?, ?)',
    ['todo-2', jsonEncode(payload)],
  );
});

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

`OptoSyncDatabase.localMutations` is a Drift table containing the target,
payload, status, stable `clientId`, decimal-string `mutationId`, operation,
base revision, and resurrection intent. `pendingMutations()`,
`protocolPushRequest()`, `acknowledgePush(response, request)`, `queueDelete()`,
and the pull checkpoint helpers implement the transport-neutral protocol v1
state machine.
`queueMutationAtomic()` and `queueDeleteAtomic()` run an application callback
on the same Drift connection and transaction as sequence allocation and queue
insertion, so a SQLite row and its optimistic intent cannot diverge.
`installSnapshot()` invokes an application-provided authoritative replacement
before advancing the snapshot checkpoint and leaves pending optimistic work
untouched; that callback must be atomic in the application's own store.

The queue defaults to at most 10,000 pending mutations and 255 KiB of UTF-8
JSON per payload. Configure `maxPendingMutations` and
`maxQueuedPayloadBytes` on `OptoSyncClient`. Refused writes throw
`QueueQuotaException` with `QUEUE_FULL` or `PAYLOAD_TOO_LARGE` before consuming
a mutation ID. `pruneConfirmed(retain: ...)` deletes only oldest acknowledged
history and never pending work.

Durability is tested against a real file-backed database: queued payloads **and**
status transitions survive closing and reopening the connection.

The schema is at version 3 (v2 added clock metadata; v3 added protocol
identity). The declared migration adds columns in place and transactionally
adopts legacy pending rows into one contiguous protocol sequence. It preserves
an existing v2 device identity or creates one durable identity, leaves legacy
synced/failed rows as non-sendable diagnostics, and advances `mutation.seq` so
the next write cannot reuse an adopted ID.

Once v3 identity metadata has committed, downgrading the same database to a
v1/v2 client is unsupported: older code cannot preserve the protocol ledger
contract for newly queued work. Roll back the application binary only with a
pre-upgrade database snapshot; otherwise remain on v3 and repair through the
documented export/reimport path rather than deleting the offline queue.

`ProtocolSyncLoop` supplies transport-neutral background orchestration:
pull-before-push/pull-after ordering, immutable batches, exact acknowledgement,
retention reset, single-flight execution, bounded paging, cancellation, and
full-jitter retry. The application still supplies `ProtocolTransport` for URLs,
authentication, token refresh, and HTTP status mapping:

```dart
final loop = ProtocolSyncLoop(client, transport, callbacks);
client.setBackgroundSyncTrigger(loop.hint);
loop.start();
```

Platform connectivity and lifecycle events should call `loop.hint()`.
Default callbacks must apply pull pages idempotently and replace snapshots
atomically when their store cannot transact with queue metadata.

RxDart record composition, explicit optimism levels, native HTTP/WebSocket/TCP
hints, Supabase/shared-auth session scoping, Flutter Workmanager, and native
iOS/Android background bridges are covered in
[Background, reactive, and session-aware sync](../../docs/BACKGROUND_REACTIVE_SYNC.md).

When authoritative rows share the Drift connection, implement
`AtomicProtocolSyncCallbacks` and use `commitPullPageAtomic()` /
`installSnapshotAtomic()`. The loop verifies that each callback persisted the
checkpoint it was given; missing checkpoint commits fail permanently instead of
silently replaying a non-idempotent application effect.

## Tests

```sh
dart pub get
dart test          # 52 tests; needs the core shared library (see Install)
```

## Docs

- [Getting started](../../docs/GETTING_STARTED.md)
- [Offline queue](../../docs/OFFLINE_QUEUE.md)
- [Reconciliation](../../docs/RECONCILIATION.md)
- [Merge semantics](../../../syncer.c/docs/MERGE_SEMANTICS.md)
