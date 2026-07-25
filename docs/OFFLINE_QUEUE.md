# The offline mutation queue

The queue is what makes a write *optimistic*: it is accepted locally, persisted,
and shown to the user before any network I/O. Everything else — flushing,
retrying, reconciling the server's answer — happens against that durable record.

## The queue model per client

All three use the same three-state lifecycle with the same numeric values, but
the record shapes differ.

| | TypeScript | Dart | Rust |
| --- | --- | --- | --- |
| Store | Dexie / IndexedDB | Drift / SQLite | your `MutationStore` impl |
| Table / type | `localMutations` | `LocalMutations` (SQL `local_mutations`) | `Mutation` |
| Status enum | `SYNC_STATUS` | `SyncStatus` | `MutationStatus` |
| Pending / Synced / Failed | `0` / `1` / `2` | `0` / `1` / `2` | `Pending` / `Synced` / `Failed` |

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
}

const SYNC_STATUS = Object.freeze({ PENDING: 0, SYNCED: 1, FAILED: 2 });
```

Dexie schema is `'++id, tableName, recordId, syncStatus'` at version 1; the
default database name is `OptoSyncDatabase`, overridable with
`new OptoSyncClient({ databaseName })`.

| Method | Signature |
| --- | --- |
| `queueMutation` | `(tableName, recordId, payload) => Promise<number>` — returns the new id |
| `pendingMutations` | `(tableName?) => Promise<LocalMutation[]>` — all `PENDING`, optionally filtered by table |
| `markMutation` | `(id, syncStatus) => Promise<void>` |
| `db` | the `OptoSyncDatabase` (a `Dexie`), public — use it for anything the three methods do not cover |

`queueMutation` calls a private `triggerBackgroundSync()` that is **an empty stub**
in the shipped library. There is no built-in background flusher; scheduling is
yours.

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
}

abstract final class SyncStatus {
  static const int pending = 0, synced = 1, failed = 2;
}
```

Note the getter name: `targetTable`, not `tableName` — `tableName` is reserved by
Drift's own `Table.tableName` API, so the getter is renamed and pinned to the
original `table_name` SQL column with `.named()`. The generated data class is
`Mutation` and the companion is `LocalMutationsCompanion`.

`OptoSyncClient` exposes only `queueMutation(tableName, recordId, payload)` and
`reconcileIncoming(...)`. Reads and status transitions go through the public `db`
field with ordinary Drift queries:

```dart
final pending = await (db.select(db.localMutations)
      ..where((t) => t.syncStatus.equals(SyncStatus.pending))
      ..orderBy([(t) => OrderingTerm.asc(t.id)]))
    .get();

await (db.update(db.localMutations)..where((t) => t.id.equals(row.id)))
    .write(LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)));
```

Like the TS client, `queueMutation` calls a private `_triggerBackgroundSync()`
that is an empty stub.

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

### Rust's `InMemoryStore` is deliberately not durable

This is a design choice, stated in the test's own header: persistence is the
integrator's (SQLite, sled, a plain file, an existing app database).
`MutationStore` is the **seam** you implement, and the durability test exists to
prove that seam is *sufficient* — not to make `InMemoryStore` something it is
not.

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
POST the payload to your server      (your transport)
  |
  +-- 2xx --------------------------> markMutation(id, SYNCED)
  +-- 4xx (permanent, e.g. 404) ----> markMutation(id, FAILED)
  +-- network error / timeout -------> leave PENDING, retry later
```

Reading the payload back out of the store (rather than keeping it in a local
variable) is what makes the loop restart-safe: after a crash the only source of
truth is the store.

### Why replay must be idempotent

An ambiguous network failure — a timeout, a dropped socket, a killed tab — leaves
the client not knowing whether the write landed. The only safe action is to send
it again. So flushing the same payload twice must be indistinguishable from
flushing it once.

The merge engine is what provides that. Under the default policy, four of the
five array strategies are idempotent, `MERGE_BY_KEY` matches by identity rather
than position, and identity-less array elements fall back to `UNION` semantics —
so a re-sent payload neither duplicates keyed records nor duplicates scalar tags.
See [`MERGE_SEMANTICS.md`](../../syncer.c/docs/MERGE_SEMANTICS.md) for the
guarantees themselves.

Proven end-to-end against a live server, in all three languages, by scenario 5:

| Language | Test |
| --- | --- |
| ts | [`opto-sync-e2e/test/clients/ts/scenarios.test.mjs`](../../opto-sync-e2e/test/clients/ts/scenarios.test.mjs) — *"5. replaying the same queued mutation leaves the document semantically unchanged"* |
| dart | [`opto-sync-e2e/test/clients/dart/test/scenarios_test.dart`](../../opto-sync-e2e/test/clients/dart/test/scenarios_test.dart) — scenario 5 |
| rust | [`opto-sync-e2e/test/clients/rust/tests/scenarios.rs`](../../opto-sync-e2e/test/clients/rust/tests/scenarios.rs) — `scenario_5_replay_idempotency` |

Each flushes one queued mutation twice and asserts that the document's
**`version` advances** — proving the second write really executed rather than
being deduplicated away — while the data stays semantically identical: no
duplicated keyed elements in `rows`, and no duplicated identity-less entries in
`tags`. The fixture (`fixtures/scenarios.json` → `replayIdempotency`) covers both
array shapes on purpose.

Scenario 6 pins the other half of the accounting: a mutation against a document
that does not exist gets a 404 and must be marked `FAILED`, never `SYNCED`, and a
following good mutation must not inherit the failure.

## The clients ship no transport

None of the three libraries contains an HTTP client. This is deliberate: what is
under test, and what you get, is the queue lifecycle plus the reconcile output —
never a re-implementation of sync inside the library.

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
