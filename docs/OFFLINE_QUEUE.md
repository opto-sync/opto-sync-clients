# The offline mutation queue

The queue is what makes a write *optimistic*: it is accepted locally, persisted,
and shown to the user before any network I/O. Everything else — flushing,
retrying, reconciling the server's answer — happens against that durable record.

## The queue model per client

TypeScript and Dart persist a three-state application queue and add protocol v1
identity to every new row. Rust retains its generic `MutationStore` queue,
exposes a serializable `protocol::ProtocolQueue`, and ships a first-party
SQLite protocol store. Gleam exposes an opaque
bounded queue with a versioned `encode_queue` / `decode_queue` snapshot codec.
Protocol state uses `Pending` / `Confirmed` because a durable server rejection
is acknowledged and must leave the retry queue.

| | TypeScript | Dart | Rust | Gleam |
| --- | --- | --- | --- | --- |
| Store | Dexie / IndexedDB | Drift / SQLite; IndexedDB-backed SQLite on web | first-party SQLite, your `MutationStore`, or persisted `ProtocolQueue` | your BEAM store, via queue snapshot |
| Table / type | `localMutations` | `LocalMutations` (SQL `local_mutations`) | `Mutation` | opaque `Queue` |
| Status enum | `SYNC_STATUS` | `SyncStatus` | `MutationStatus` | `LocalStatus` |
| Pending / confirmed | `0` / `1` | `0` / `1` | `Pending` / `Confirmed` in protocol state | `Pending` / `Confirmed` |

### TypeScript

[`clients/ts/src/client.ts`](../clients/ts/src/client.ts)

```ts
interface LocalMutation {
  id?: number;         // ++id, Dexie-assigned
  tableName: string;
  recordId: string;
  jsonPayload: string; // JSON.stringify of the payload you passed
  createdAt: number;   // Date.now() at queue time
  syncStatus: number;  // SYNC_STATUS.PENDING | SYNCED | FAILED
  clientId?: string;   // stable installation identity
  mutationId?: string; // contiguous decimal sequence
  operation?: 'upsert' | 'delete';
  baseRevision?: string;
  resurrect?: boolean;
  attempts?: number;
  lastError?: string;
}

const SYNC_STATUS = Object.freeze({ PENDING: 0, SYNCED: 1, FAILED: 2 });
```

The current Dexie schema is version 3. Versions 1 and 2 remain declared so
IndexedDB upgrades preserve pending work; v3 adds protocol identity and a
`[tableName+recordId]` index. The default database name is
`OptoSyncDatabase`, overridable with `new OptoSyncClient({ databaseName })`.

| Method | Signature |
| --- | --- |
| `queueMutation` | `(tableName, recordId, payload, {baseRevision?, resurrect?}) => Promise<number>` |
| `queueDelete` | `(tableName, recordId, {baseRevision?}) => Promise<number>` |
| `queueMutationAtomic` | `(tableName, recordId, payload, authoritativeTables, applyOptimistic, protocol?)` — one IndexedDB transaction |
| `queueDeleteAtomic` | `(tableName, recordId, authoritativeTables, applyOptimisticDelete, options?)` — one IndexedDB transaction |
| `pendingMutations` | `(tableName?) => Promise<LocalMutation[]>` — all `PENDING`, optionally filtered by table |
| `markMutation` | `(id, syncStatus) => Promise<void>` |
| `protocolPushRequest` | `(limit?) => Promise<PushRequest>` — protocol options must already be durable on each queued row |
| `acknowledgePush` | `(PushResponse, PushRequest) => Promise<number>` — validates and drains exactly the sent batch |
| `pullCheckpoint` / `setPullCheckpoint` | persist the opaque pull cursor as a decimal string |
| `setBackgroundSyncTrigger` | `(() => void) => void` — attach `ProtocolSyncLoop.hint()` after durable queue commits |
| `db` | the `OptoSyncDatabase` (a `Dexie`), public — use it for anything the three methods do not cover |

TypeScript also exports `ProtocolSyncLoop`, a transport-neutral scheduler. It
performs pull-before-push/pull-after cycles, snapshots immutable push batches,
handles `RESET_REQUIRED`, coalesces concurrent work, observes browser
online/visibility state, and retries transient failures with full-jitter
backoff. Attach its `hint()` with `setBackgroundSyncTrigger`; hook failures
cannot roll back a queue commit.

Same-database applications can implement the optional
`applyChangesAndCheckpoint` / `replaceAuthoritativeAndCheckpoint` callbacks
with `commitPullPageAtomic` / `installSnapshotAtomic`. The loop reads the
checkpoint back and fails closed if the callback did not persist it.

### Dart

[`clients/dart/lib/opto_sync_client.dart`](../clients/dart/lib/opto_sync_client.dart)

```dart
@DataClassName('Mutation')
class LocalMutations extends Table {
  IntColumn      get id           => integer().autoIncrement()();
  TextColumn     get targetTable  => text().named('table_name')();
  TextColumn     get recordId     => text()();
  TextColumn     get jsonPayload  => text()();
  DateTimeColumn get createdAt    => dateTime().withDefault(currentDateAndTime)();
  IntColumn      get syncStatus   => integer().withDefault(const Constant(0))();
  TextColumn     get clientId     => text().nullable()();
  TextColumn     get mutationId   => text().nullable()();
  TextColumn     get operation    => text().withDefault(const Constant('upsert'))();
  TextColumn     get baseRevision => text().nullable()();
  BoolColumn     get resurrect    => boolean().withDefault(const Constant(false))();
  IntColumn      get attempts     => integer().withDefault(const Constant(0))();
  TextColumn     get lastError    => text().nullable()();
}

abstract final class SyncStatus {
  static const int pending = 0, synced = 1, failed = 2;
}
```

Note the getter name: `targetTable`, not `tableName` — `tableName` is reserved by
Drift's own `Table.tableName` API, so the getter is renamed and pinned to the
original `table_name` SQL column with `.named()`. The generated data class is
`Mutation` and the companion is `LocalMutationsCompanion`.

The Drift database is at schema version 3. Its v1/v2 migrations add protocol
columns without rebuilding `local_mutations`, so an upgrade does not discard
offline work. During that same transaction, pending legacy rows receive one
durable client identity and contiguous decimal mutation IDs in original row
order; `mutation.seq` advances to the final adopted ID. Synced and failed
legacy rows retain their payload/status history but no sendable identity.
Migration interruption rolls back the schema and adoption together.

A v3 database must not be reopened by a v1/v2 binary after new work has been
queued: those binaries do not understand the protocol sequence and may create
unidentified rows. Restore a pre-upgrade snapshot for a full binary/database
rollback, or keep the v3 database and repair/export it with a v3-capable tool.

`OptoSyncClient` exposes `queueMutation`, `queueDelete`,
`queueMutationAtomic`, `queueDeleteAtomic`,
`pendingMutations`, `protocolPushRequest`, `acknowledgePush(response, request)`,
`pullCheckpoint`, and `setPullCheckpoint`. The public `db` remains available
for application-specific queries and transactions:

```dart
final pending = await (db.select(db.localMutations)
      ..where((t) => t.syncStatus.equals(SyncStatus.pending))
      ..orderBy([(t) => OrderingTerm.asc(t.id)]))
    .get();

await (db.update(db.localMutations)..where((t) => t.id.equals(row.id)))
    .write(LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)));
```

Dart exports its own `ProtocolSyncLoop` with the same pull-before-push,
pull-after, reset, bounded batching, single-flight, cancellation, and retry
contract. Attach `loop.hint` with `setBackgroundSyncTrigger`; platform
connectivity and lifecycle events should invoke the same hint.

For an application table on the same SQLite connection,
`queueMutationAtomic` / `queueDeleteAtomic` wrap the application callback,
quota check, mutation sequence, and queue insert in one Drift transaction.
The callback must use the client's public `db`; a separate database connection
cannot participate.

For downloads, implement `AtomicProtocolSyncCallbacks` and delegate to
`commitPullPageAtomic` / `installSnapshotAtomic`. Otherwise the coordinator
keeps the idempotent apply-then-checkpoint ordering for separate stores.

### Rust

[`clients/rust/src/lib.rs`](../clients/rust/src/lib.rs)

```rust
pub enum MutationStatus { Pending, Synced, Failed }

pub struct Mutation {
    pub id: u64,
    pub payload: String,
    pub status: MutationStatus,
}

pub trait MutationStore {
    fn queue_mutation(&mut self, payload: String) -> u64;
    fn pending(&self) -> Vec<Mutation>;          // oldest first
    fn mark_synced(&mut self, id: u64) -> bool;  // false = unknown id
    fn mark_failed(&mut self, id: u64) -> bool;  // false = unknown id
}
```

`OptoSyncClient<S: MutationStore>` wraps a store plus `ReconcileOptions` and
exposes `queue_mutation`, `reconcile_incoming`, `options()`, `store()`,
`store_mut()`. `InMemoryStore` additionally offers `new()` and
`all() -> &[Mutation]` (every mutation ever queued, any status, oldest first).

Marking an unknown id returns `false` rather than panicking or silently
succeeding — asserted in `tests::queue_lifecycle`.

For protocol v1, use `protocol::ProtocolQueue`. It allocates contiguous decimal
mutation IDs, encodes exact `operation` envelopes for upsert/delete, drains all
rows covered by `lastMutationId` (including permanent rejection), and stores an
opaque pull checkpoint. `install_snapshot` orders an application-provided
authoritative replacement before that checkpoint and never drains pending work.
`sqlite::SqliteProtocolStore` is the default durable path. It persists the
whole queue, authoritative records, accepted-but-not-yet-observed overlays, and
the rendered local view in one strict WAL-backed SQLite schema. Its
`queue_upsert_record` / `queue_delete_record` methods are ready-made reference
operations. `queue_upsert_with` / `queue_delete_with` pass the same transaction
to application SQL, so a callback failure cannot leave a row without its queue
intent or consume a mutation ID.

`protocol_sync::ProtocolSyncDriver` supplies the runtime-neutral
pull-before-push/pull-after cycle. Its `ProtocolTransport`,
`ProtocolSyncCallbacks`, and `ProtocolQueuePersistence` boundaries keep HTTP,
the authoritative store, and durable queue storage explicit. If persistence
fails after an acknowledgement or checkpoint update, the driver restores the
prior in-memory queue so retry remains safe.

`sync_cycle_atomic` plus `AtomicProtocolSyncStore` is the stronger
same-database path. `SqliteProtocolStore` implements it directly: pull pages,
reset snapshots, acknowledgements, local-view rebase, and queue/checkpoint
state commit together. Accepted overlays remain durable until a pull
checkpoint covers their server result, so a rejection in a later batch cannot
make an earlier accepted edit flicker away. `sync_cycle` remains available when
stores are separate and repeated page application is idempotent.

The atomic trait receives a mutable queue because the SQLite store may discover
a mutation appended by another connection after the driver loaded its clone.
Every sync-side transaction merges those higher contiguous IDs back into the
driver and durable queue. It refuses altered bytes, pending-row pruning,
sequence regression, or limit/client mismatches rather than overwriting
concurrent work.

### Gleam

[`clients/gleam/src/opto_sync_client.gleam`](../clients/gleam/src/opto_sync_client.gleam)
provides `new`, bounded `enqueue_upsert` / `enqueue_delete`,
`build_push_request`, `encode_push_request`, typed response decoding, strict
`acknowledge`, checkpoint state, and confirmed-row compaction.

Persist `encode_queue(queue)` in the same transaction as the optimistic
application row and restore with `decode_queue`. The snapshot stores payload
JSON as an escaped string, so it preserves the exact original bytes and
reconstructs a byte-identical retry envelope after restart. Restore rejects
unknown versions, noncanonical/out-of-order IDs, invalid JSON objects,
over-limit state, and inconsistent sequence watermarks.

Reconciliation calls the dedicated typed Gleam wrapper over the BEAM
Rustler/C NIF. HTTP and the concrete BEAM database library remain
application-supplied.

## Storage bounds and pruning

The protocol-aware TypeScript, Dart, Rust, and Gleam queues use the same conservative
defaults:

| Limit | Default | TypeScript | Dart | Rust | Gleam |
| --- | ---: | --- | --- | --- | --- |
| Pending mutations | 10,000 | `maxPendingMutations` | `maxPendingMutations` | `ProtocolQueue::with_limits` | `new_with_limits` |
| One JSON payload | 255 KiB UTF-8 | `maxQueuedPayloadBytes` | `maxQueuedPayloadBytes` | `ProtocolQueue::with_limits` | `new_with_limits` |

The payload default leaves headroom inside the reference server's default
256 KiB mutation-envelope quota. Keep the client limit no larger than the
server limit after accounting for envelope fields, or the device can durably
queue work the server will always refuse.

A refusal is `QUEUE_FULL` or `PAYLOAD_TOO_LARGE` in TypeScript/Dart and
`ProtocolError::QueueFull` or `ProtocolError::PayloadTooLarge` in Rust. Payload
size and pending count are checked before allocating a mutation ID; rejected
work cannot create a sequence gap. TypeScript and Dart perform the count and
sequence allocation in the same database transaction.

`pruneConfirmed(retain)` / `pruneConfirmed(retain: ...)` /
`prune_confirmed(retain)` remove only the oldest confirmed history and retain
the requested newest entries. They never evict pending work. Applications
should surface queue exhaustion to the user, pause new offline writes, and
flush or obtain explicit user direction—silently dropping the oldest pending
mutation corrupts intent.

The Rust limit applies to the serializable `ProtocolQueue`; implementations of
the generic `MutationStore` trait must enforce equivalent database quotas
themselves.

## Durability

**A pending write must survive the app closing.** Each client has a test that
demonstrates exactly that, and each of them also checks the less obvious half:
that a *status transition* is durable too, because otherwise a relaunch would
re-send work the server already accepted.

| Client | Test | What is actually guaranteed |
| --- | --- | --- |
| ts (Node) | `test/queue.test.js` — *"queued mutations survive closing and reopening the database"* | `db.close()`, then a brand-new `OptoSyncClient` on the same `databaseName` recovers both pending writes, still `PENDING`; a `SYNCED` mark taken before closing does not come back as pending. Backed by `fake-indexeddb`. |
| ts (browser path, jsdom) | `test/browser-fallback.test.mjs` — *"queued writes survive close/reopen on the browser path too"* | the same close/reopen recovery through the ESM browser entry and the wasm engine |
| ts (real browser) | `test/browser-e2e.test.mjs` | the strongest form: Chromium's own IndexedDB. After `close()`, `indexedDB.databases()` must list the database, a new client recovers the surviving pending mutation and its payload, and the rows are re-read through the bare `indexedDB.open`/`getAll` API. This is what rules out an in-memory Dexie fallback. |
| dart | `test/opto_sync_client_test.dart` — *"queued mutations survive closing and reopening the database"* | a **real file** (`NativeDatabase(File(...))`, not `NativeDatabase.memory()`); `db.close()` stands in for process exit; the file is asserted to exist and be non-empty; a fresh connection recovers both rows as `pending`; then a status write, another close, and a third connection confirms exactly one `synced` and one `pending`. |
| rust | `tests/durability.rs` — `queued_mutations_and_statuses_survive_a_reload` | three scoped sessions over one file: queue two and drop the client (as an app exit would), reopen and recover both as `Pending`, mark one synced, reopen again and see exactly one `Pending`. |

`tests/durability.rs` also contains `reconcile_still_works_against_a_recovered_queue`:
a payload replayed from disk reconciles identically to one queued in memory, so
recovery cannot change merge semantics.

The E2E suite goes beyond connection reopen. It launches fresh Dart and Rust
processes and three separate Chromium processes over one persistent IndexedDB
profile. It commits a push without acknowledging it, injects an interrupted
snapshot replacement that leaves visible partial application state, exits,
then verifies on restart that:

1. the pull checkpoint is still `"0"`;
2. the pending mutation and its exact encoded envelope survived;
3. retrying the complete snapshot repairs the authoritative store before
   advancing its checkpoint;
4. the push retry returns the original durable result as `duplicate`; and
5. the acknowledgement and snapshot checkpoint survive another restart.

`installSnapshot` (TypeScript/Dart) and `install_snapshot` (Rust) provide the
safe ordering, but not a cross-store transaction. The supplied replacement
callback must use the application's own atomic transaction or replacement
primitive.

### Rust's `InMemoryStore` is deliberately not durable

This is a design choice, stated in the test's own header. Protocol v1 users can
use the bundled `SqliteProtocolStore`; sled, a plain file, an ORM, or an
existing database can implement the generic or atomic store traits.
`MutationStore` remains a seam, and the durability test proves that seam is
*sufficient* — it does not make `InMemoryStore` durable.

The working example is `FileStore` in
[`clients/rust/tests/durability.rs`](../clients/rust/tests/durability.rs): a
line-oriented `id \t status \t payload` file that reloads its rows and
`next_id` in `open()` and calls `flush()` **synchronously on every mutation and
every status change** — an fsync-less queue would lose exactly the writes the
test exists to protect. Copy the shape, not the encoding; a real implementation
should use its database's own.

If you use `InMemoryStore` in production, queued writes die with the process.

## The flush / replay lifecycle

```
queueMutation(...)                  -> PENDING, persisted
  |
  |  read the pending set back out of the store
  v
POST an immutable protocol batch      (your transport)
  |
  +-- v1 response ------------------> acknowledge through lastMutationId
  |                                   (applied and rejected both exit PENDING)
  +-- request-level 409 ------------> repair the gap/content-reuse bug
  +-- network error / timeout -------> leave PENDING, retry later
```

Reading the payload back out of the store (rather than keeping it in a local
variable) is what makes the loop restart-safe: after a crash the only source of
truth is the store.

### Why replay needs a server ledger

An ambiguous network failure — a timeout, a dropped socket, a killed tab — leaves
the client not knowing whether the write landed. The only safe action is to send
it again. So flushing the same payload twice must be indistinguishable from
flushing it once.

Merge idempotence is useful but is not an acknowledgement protocol. The server
may increment revisions, write audit rows, send events, or execute a non-LWW
effect even when the merged JSON happens to be unchanged. Protocol v1 therefore
hashes immutable `(clientId, mutationId)` content and commits its ledger row,
record effect, client watermark, and pull change atomically. An identical retry
returns the original result without executing the effect twice.

Proven end-to-end against a live server by the TypeScript/Dart/Rust scenario 5
suites and the Gleam protocol retry test:

| Language | Test |
| --- | --- |
| ts | [`opto-sync-e2e/test/clients/ts/scenarios.test.mjs`](../../opto-sync-e2e/test/clients/ts/scenarios.test.mjs) — *"5. replaying the same queued mutation leaves the document semantically unchanged"* |
| dart | [`opto-sync-e2e/test/clients/dart/test/scenarios_test.dart`](../../opto-sync-e2e/test/clients/dart/test/scenarios_test.dart) — scenario 5 |
| rust | [`opto-sync-e2e/test/clients/rust/tests/scenarios.rs`](../../opto-sync-e2e/test/clients/rust/tests/scenarios.rs) — `scenario_5_replay_idempotency` |

These legacy endpoint scenarios flush one queued payload twice and assert that
the document's
**`version` advances** — proving the second write really executed rather than
being deduplicated away — while the data stays semantically identical: no
duplicated keyed elements in `rows`, and no duplicated identity-less entries in
`tags`. The fixture (`fixtures/scenarios.json` → `replayIdempotency`) covers both
array shapes on purpose. They prove merge idempotence, not exactly-once
application. The protocol v1 conformance suite separately proves retry
deduplication and transaction rollback.

Scenario 6 pins the other half of the accounting: a mutation against a document
that does not exist gets a 404 and must be marked `FAILED`, never `SYNCED`, and a
following good mutation must not inherit the failure.

## The clients ship no concrete transport

None of the four libraries contains an HTTP client. This is deliberate: the
SDKs own durable queue state, exact protocol envelopes, acknowledgements,
checkpoints, and reconciliation; the application owns URLs, authentication,
token refresh, HTTP error mapping, and atomic installation of pulled changes
into its authoritative store.

TypeScript and Dart own background scheduling through `ProtocolSyncLoop`:
single-flight execution, bounded pull/push batches, pull-before-push/pull-after
ordering, retention reset, and retry backoff. TypeScript directly observes
browser lifecycle events; Dart accepts platform lifecycle hints. Rust supplies
the same cycle as `ProtocolSyncDriver` without choosing a timer, thread, or
async executor.

The reference pattern lives in
[`opto-sync-e2e/test/clients/`](../../opto-sync-e2e/test/clients/), one support
module per language, each driving the client entirely through its **public**
surface:

| Language | Support module | Queue access it uses |
| --- | --- | --- |
| ts | `ts/support.mjs` (`fetch`) | `pendingMutations()` / `markMutation()` / `client.db.localMutations` |
| dart | `dart/lib/support.dart` (`dart:io` `HttpClient`) | Drift queries against the exposed `OptoSyncDatabase` |
| rust | `rust/src/lib.rs` (`ureq`, `default-features = false`) | `MutationStore` |

A minimal flush of one mutation, taken from the TS suite:

```js
async function flushOne(client, mutation, docId) {
  const res = await syncDoc(docId, JSON.parse(mutation.jsonPayload));
  await client.markMutation(mutation.id, res.ok ? SYNC_STATUS.SYNCED : SYNC_STATUS.FAILED);
  return res;
}
```

Note that HTTP status is treated as a *value*, not an exception: the failure-marking
path needs to inspect a 404 the way a real client would. Only transport failures
are errors.

### The reference server's endpoints

Implemented in
[`opto-sync-e2e/servers/node/src/index.ts`](../../opto-sync-e2e/servers/node/src/index.ts).
Documents are stored in a Postgres `jsonb` column and merged with the same
syncer.c core the clients use.

**`POST /doc/:id/sync`** — one mutation. Body *is* the payload.

```
200 { merged: true, attempts, document: { id, data, version, updated_at },
      mergedWith: "native-c-ffi" | "js-fallback", resurrected }
404 { error: "Document not found" }
410 { error: "Document deleted", deleted: true, tombstoneAt }   // tombstone wins
```

It re-reads, merges and writes under an optimistic compare-and-swap on `version`,
retrying on a lost race (`?noRetry=1` disables the retries). Every e2e suite also
asserts `mergedWith === "native-c-ffi"`, because against a JS fallback the
convergence assertions would be false confidence.

**`POST /sync/batch`** — the shape an offline queue flushes in.

```
POST /sync/batch
{ "mutations": [ { "docId": "doc-1", "payload": { ... } },
                 { "docId": "doc-2", "payload": { ... } } ] }

200 { applied: 2,
      results: [ { docId: "doc-1", applied: true },
                 { docId: "doc-2", applied: false, error: "not found" } ] }
400 { error: "Body must be { mutations: [{ docId, payload }] }" }
```

The whole batch runs inside one `BEGIN`/`COMMIT`, taking
`SELECT ... FOR UPDATE` per document so concurrent batches on the same document
serialize. A missing document is recorded as `applied: false` for that entry
rather than aborting the batch. Scenario 1 flushes the identical three-mutation
queue both one-by-one and via `/sync/batch` and asserts both land on the same
document.

`PUT /doc/:id` (create-or-replace, no merge), `GET /doc/:id` (parsed) and
`GET /doc/:id/raw` (the exact stored `jsonb` text) also exist and are used by the
suites for setup and verification.

## API asymmetry: Rust records no target

Verified against the source, and worth knowing before you build a flush loop:

| | records the target | fields |
| --- | --- | --- |
| ts `LocalMutation` | yes | `tableName`, `recordId` (+ `id`, `jsonPayload`, `createdAt`, `syncStatus`) |
| dart `Mutation` | yes | `targetTable` / SQL `table_name`, `recordId` (+ `id`, `jsonPayload`, `createdAt`, `syncStatus`) |
| rust `Mutation` | **no** | `id`, `payload`, `status` only |

So in Rust a queued mutation does not know where it should be sent. `queueMutation`
takes only the payload string. The e2e suite handles this with a small
`Routes(BTreeMap<u64, String>)` map from mutation id → document id
([`opto-sync-e2e/test/clients/rust/src/lib.rs`](../../opto-sync-e2e/test/clients/rust/src/lib.rs)),
so the flush loop is still driven entirely through the crate's public queue API.
You need the same thing, or you need to embed the target inside the payload
string. Nothing was added to the crate to accommodate it.
