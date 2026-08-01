# opto-sync-client for Rust

Rust bindings for the shared syncer.c reconciliation policy, optimistic queue
primitives, protocol v1 envelopes, and runtime-neutral synchronization.

`protocol::ProtocolQueue` is serializable and stores stable client identity,
contiguous decimal mutation IDs, explicit upsert/delete operations, pending
status, and the pull checkpoint. Persist it after every mutation and status
transition.

The default `sqlite` feature provides `sqlite::SqliteProtocolStore`. It owns a
strict, WAL-backed protocol schema, an authoritative cache, and a derived local
view. Queue allocation, queue quotas, an application callback, and the
optimistic view commit under one `BEGIN IMMEDIATE` transaction:

```rust
let mut store = SqliteProtocolStore::open("opto-sync.sqlite", stable_client_id)?;
store.queue_upsert_record(
    "tasks",
    "task-1",
    serde_json::json!({"title": "offline"}),
    None,
    false,
)?;
let mut queue = store.load_queue()?;
```

Use `queue_upsert_with` or `queue_delete_with` when an application table shares
this connection; the callback receives the same SQLite transaction. A callback
error rolls back the application row, optimistic view, queue entry, quota
accounting, and mutation ID together.

`protocol_sync::ProtocolSyncDriver` owns the correctness-sensitive cycle while
leaving HTTP, authentication, timers, and executor selection to the
application:

```rust
let driver = ProtocolSyncDriver::new(ProtocolSyncOptions::default())?;
let result = driver.sync_cycle(
    &mut queue,
    &mut transport,
    &mut authoritative_store,
    &mut queue_persistence,
)?;
```

The cycle pulls to current, uploads immutable batches, validates and
acknowledges exactly the batch sent, then pulls the server echo. It handles
retention snapshots and reverts in-memory queue/checkpoint changes when durable
persistence fails. Run it on a worker thread or a runtime blocking boundary;
WebSocket or Supabase Realtime notifications are wake-up hints.

Implement:

- `ProtocolTransport` for push, pull, and snapshot HTTP;
- `ProtocolSyncCallbacks` for idempotent pull application and atomic snapshot
  replacement;
- `ProtocolQueuePersistence` for durable queue state.

`SqliteProtocolStore` already implements `AtomicProtocolSyncStore`:

```rust
let result = driver.sync_cycle_atomic(
    &mut queue,
    &mut transport,
    &mut store,
)?;
```

The adapter receives the already-advanced in-memory queue alongside each pull
page or reset snapshot and must commit both together. A failed store commit
restores the prior in-memory checkpoint. This path removes the crash window
between application-row updates and checkpoint persistence; the original
`sync_cycle` remains the replay-safe option for separate stores.

Accepted optimistic overlays stay durable until a pull checkpoint proves their
authoritative echo is installed. This prevents a later rejection on the same
record from briefly erasing an earlier accepted write. Rejections, pull pages,
snapshots, and their queue/checkpoint transitions are committed atomically.
Before each sync-side commit the store merges mutations appended by another
SQLite connection back into the driver's mutable queue. Immutable-byte,
monotonic-status, and sequence checks prevent a stale sync loop from
overwriting concurrent offline work.

`schema` validates the cross-language ingest envelope defined by
`schema/opto-sync-envelope.schema.json` and turns a validated file or blob into
ordinary queued mutations, so an import converges through the normal
push/reconcile path instead of a direct-to-database shortcut:

```rust
use opto_sync_client::schema::{ingest_envelope, IngestOptions};

let mutation_ids = ingest_envelope(&mut queue, &json, IngestOptions::default())?;
```

Validation is all-or-nothing and the records are staged against a copy of the
queue, so a rejected envelope leaves it byte-identical and the same file can be
retried. `parse_envelope` alone validates without queueing. The TypeScript,
Dart, and Gleam validators are held to the same fixture corpus in
`schema/fixtures/`.

The crate intentionally selects no HTTP client, async executor, or ORM. Disable
the first-party database with `default-features = false` when an application
supplies another `AtomicProtocolSyncStore`.

```sh
cargo test
cargo test --no-default-features
cargo clippy --all-targets -- -D warnings
```
