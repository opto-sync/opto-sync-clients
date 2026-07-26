# Sync patterns: how opto-sync compares, and what it is missing

An honest assessment of this library against the established Postgres-backed
local-first sync engines, written after reading their current documentation
(Electric, PowerSync, Zero/Replicache, Triplit, and Linear's published
architecture). It exists so an adopting team can tell what opto-sync gives them
and what they must still build.

Read [../../syncer.c/docs/MERGE_SEMANTICS.md](../../syncer.c/docs/MERGE_SEMANTICS.md)
first for what the merge engine actually guarantees.

## What opto-sync is

A **shared conflict-resolution engine** plus a **durable local write queue**. One
C implementation of deep-merge-with-timestamp-resolution, callable identically
from a browser, a phone, a server, and five languages, so every tier resolves
the same conflict the same way — verified byte-for-byte by a cross-language
differential suite.

That is a real and unusual thing to have. It is **not** a complete sync engine,
and the gap matters.

## The Linear pattern: now present, but not yet end-to-end

Five out of five surveyed engines keep **two local layers** and merge them on
read:

| Engine | Synced layer | Pending layer |
|---|---|---|
| PowerSync | `ps_data__*` | `ps_crud` (FIFO upload queue) |
| Electric (through-the-DB pattern) | `todos_synced` | `todos_local` + a `changes` log |
| Replicache / Zero | Client View | pending mutation list |
| Triplit | cache | outbox |
| Linear | IndexedDB-backed model store | durable IndexedDB transaction queue + optimistic in-memory MobX graph |

Nobody merges an optimistic write destructively into the synced copy. Keeping
them separate is what makes it possible to:

- show the user which fields are still unconfirmed (Triplit exposes querying
  each layer separately as a first-class feature);
- roll back **one** rejected write while keeping the other nine;
- re-apply pending writes after a forced resync;
- distinguish "the server has not sent me this yet" from "I wrote this and it
  has not gone up yet".

opto-sync now implements the same logical split in all three clients:
`localView`/`local_view` takes authoritative server state as the base and
`rebasePending` replays the durable queue oldest-first. TypeScript persists the
queue in IndexedDB through Dexie; Dart persists it in SQLite through Drift; Rust
ships a WAL-backed `SqliteProtocolStore` and retains storage traits for other
databases.

The remaining difference is ownership. Linear owns the model store,
transaction queue, network protocol, and MobX projection as one system.
opto-sync still leaves the synced store and UI graph to the application.
TypeScript and Dart provide `queueMutationAtomic` / `queueDeleteAtomic` when
the application row shares the client's IndexedDB/SQLite database. Rust's
`queue_upsert_with` / `queue_delete_with` expose the same transaction from its
first-party SQLite adapter. Across separate stores no library can manufacture atomicity:
treat the queue as the durable source of optimistic intent and derive the
rendered view with `localView`, rather than destructively writing the
optimistic result into the synced copy.

This is the architectural lesson from Linear worth preserving: local mutation
is the foreground path; network synchronization is asynchronous infrastructure.
Their CTO describes starting with the sync engine, and the published breakdown
describes immediate MobX updates plus an IndexedDB transaction queue
([technical breakdown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown),
[Local-First FM transcript](https://www.localfirst.fm/15/transcript)).

## Code-level comparison with open-source engines

The useful comparison is protocol machinery, not surface API:

| Engine | Source-level mechanism | What opto-sync should copy |
|---|---|---|
| Replicache | Rebuilds a client view by applying a server patch and replaying pending mutations in [`rebase.ts`](https://github.com/rocicorp/mono/blob/main/packages/replicache/src/db/rebase.ts) | Keep `localView`; add one cross-language mutation envelope and server watermark contract |
| Electric | Its “through the DB” example records ordered changes, groups them by transaction, distinguishes accept/reject/retry, and rolls local state back on rejection in [`sync.ts`](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/sync.ts) | Preserve transaction boundaries and make rejection a first-class queue state |
| RxDB | Stores directional checkpoints, compare-and-swaps against an assumed master state, resolves conflicts, and treats the live stream as a `RESYNC` hint in [`upstream.ts`](https://github.com/pubkey/rxdb/blob/master/src/replication-protocol/upstream.ts) and [`checkpoint.ts`](https://github.com/pubkey/rxdb/blob/master/src/replication-protocol/checkpoint.ts) | Add opaque pull checkpoints, assumed-server revisions, and explicit resync |
| WatermelonDB | Pulls and applies remote changes before fetching/pushing local changes, then marks exactly that fetched batch synced in [`synchronize.js`](https://github.com/Nozbe/WatermelonDB/blob/master/src/sync/impl/synchronize.js) | Snapshot a push batch and acknowledge that snapshot, not “whatever is pending now” |
| PowerSync | Separates synced bucket storage from CRUD upload transactions, represented in [`CrudTransaction.ts`](https://github.com/powersync-ja/powersync-js/blob/main/packages/common/src/client/sync/bucket/CrudTransaction.ts) | Add transaction grouping and a durable download checkpoint; do not rely on timestamps as cursors |

opto-sync’s C merge is complementary to these mechanisms. It can be the shared
conflict handler inside a protocol, but a deterministic merge function does not
replace ordering, acknowledgments, authorization, tombstones, or reset.

## Clocks: what we fixed, and why it mattered

Every surveyed engine either uses **no clock at all** for ordering (Electric uses
Postgres LSN; Replicache/Zero use a per-client sequence linearized by server
arrival order; PowerSync uses `op_id` + checkpoints) or uses a **logical** clock
(Triplit uses Lamport timestamps). PowerSync's docs describe comparing client
`updatedAt` values and name the failure mode outright: clock drift produces false
conflicts, and they recommend incrementing version counters instead.

opto-sync previously trusted whatever `updatedAt` the application supplied, which
is the one option nobody ships. All three clients now generate timestamps from a
**hybrid logical clock** ([clock.ts](../clients/ts/src/clock.ts),
[clock.dart](../clients/dart/lib/src/clock.dart),
[clock.rs](../clients/rust/src/clock.rs)) with a byte-identical wire format:

```
1721822400000-00ff-9f3a2b
└ 13-digit ms ┘└ ctr ┘└ node ┘
```

- **never moves backwards**, so an NTP correction cannot make a device's later
  edits lose to its own earlier ones;
- **counter** breaks ties within a millisecond;
- **node id** makes cross-writer ties impossible, giving a total order — and
  therefore convergence, since the engine treats equal timestamps as "neither
  newer" and falls through to arrival order;
- **observes** remote timestamps so the next local write is ordered after
  anything already seen (this is the *hybrid* part — it respects causality);
- persists, so it survives a reload.

The node id is a durable device id **plus a per-instance suffix**, because
browser tabs share one IndexedDB: a purely persisted id would let two tabs issue
identical timestamps and reintroduce the tie. Replicache solves the same problem
with per-tab client groups.

An HLC makes ordering *consistent*; it does not make a clock *accurate*. Where
the server sees a write, a server-stamped timestamp is strictly better. Prefer
server stamping for `syncedAt` and use the HLC for the `updatedAt` that must
exist before the server ever sees the write.

## Protocol v1 closes the highest-risk gaps

Ordered by how much damage they cause. None of these require adopting mutation
replay.

### 1. Acknowledgement is now explicit across TypeScript, Dart, and Rust

The IndexedDB and Drift queues allocate `(clientId, mutationId)` atomically with
their queue insert. The Rust SDK exposes a serializable, transport-neutral
`ProtocolQueue` with the same envelope and state transitions. All three encode
decimal IDs as strings, drain durable rejection through the server watermark,
and persist opaque pull checkpoints.

The PostgreSQL reference server in `opto-sync-e2e/servers/node/src/protocol.ts`
commits the mutation ledger, client watermark, record effect, and change-log
checkpoint in one transaction. The 22-case / 160-assertion protocol conformance
suite covers ambiguous retries—including a committed write whose response
socket disappears—content reuse, gaps, injected rollback windows, rejection,
concurrency, tombstones, pagination, compaction, and reset.

You may be tempted to argue that a deep merge is idempotent so retries are
harmless. **It is not, for any non-LWW field.** Counters, `attempts++`, list
append, "add this member", "only transition if currently pending" — a retry
doubles the effect. If your documents contain any such field, you need the
watermark.

### 2. Pull uses commit-ordered checkpoints, never timestamps

A transaction that takes its timestamp at T1 but commits at T3, racing one that
commits at T2, is invisible to a `> T2` cursor **forever**. Protocol v1 instead
serializes checkpoint allocation under a PostgreSQL row lock, so the checkpoint
orders commits. The contract remains transport- and database-neutral: another
backend may use an LSN or another opaque total-order token.

### 3. Compaction has an explicit reset path

When a checkpoint predates retained change history, pull returns
`RESET_REQUIRED`; the client replaces its authoritative store from one
repeatable-read snapshot and then re-applies pending mutations. Checksums and
bucket-scoped repair remain future extensions.

### 4. Permanent rejection is a durable mutation outcome

Deep merge is a total function: it always returns an answer, so there is no
natural place for "the server said no" (permissions, RLS, validation). Two rules
worth copying:

- A **permanently invalid** write must be acknowledged and dropped, not retried
  forever. Replicache: mark it processed and increment the watermark anyway.
  PowerSync: return 2xx for validation errors, reserve error responses for
  transient failures — otherwise one poison-pill write blocks the queue.
- Envelope conflicts such as mutation gaps and mutation-ID content reuse remain
  HTTP 409 and roll the request back. Per-mutation validation/revision conflicts
  are stored as `rejected`, advance the client watermark, and cannot poison the
  queue.

### 5. Deletes are explicit protocol operations

A timestamp cannot express "this is deleted", and absence is ambiguous between
"deleted" and "not yet synced to me". Protocol v1 carries `delete` separately
from `upsert`, retains a tombstone revision, and requires an explicit
revision-matched `resurrect`. A client offline beyond retention takes the reset
path instead of replaying absence as truth.

Within an array, `MERGE_BY_KEY` cannot express element *removal*: unmatched base
elements are kept by design, so a removal looks like "the other side just didn't
mention it". Mark elements deleted with a field rather than omitting them.

### 6. Sync metadata lives inside the merged document

`syncedAt` is in the default LWW key list, which means bookkeeping sits in the
same JSON the merge engine reads and can be clobbered by — or can win against —
a peer's stale value. Every surveyed engine keeps sync metadata strictly outside
user data. Consider dropping `syncedAt` from `lwwKeys` and tracking it beside the
document.

### 7. Transport remains application-owned; orchestration now ships

None of the SDKs embeds endpoint URLs, credentials, token refresh, or an HTTP
stack. TypeScript and Dart export `ProtocolSyncLoop`; Rust exports
`ProtocolSyncDriver`. They supply the correctness-sensitive cycle around an
application transport:
single-flight pull-before-push/pull-after cycles, immutable batch
acknowledgement, `RESET_REQUIRED` snapshot installation, browser lifecycle
wakeups, bounded paging, and exponential full-jitter retry with Retry-After
support. Durable queue commits can wake it through
`setBackgroundSyncTrigger(() => loop.hint())`.

This follows the source-level patterns above: live events are hints, the
checkpointed pull is authoritative, and a server page is applied before its
checkpoint advances. TypeScript observes browser lifecycle directly, Dart
accepts platform lifecycle hints, and Rust deliberately leaves timer/executor
selection to the application.

All three also expose a stronger same-database path: TypeScript atomic
callbacks use `commitPullPageAtomic` / `installSnapshotAtomic`, Dart uses
`AtomicProtocolSyncCallbacks`, and Rust uses `AtomicProtocolSyncStore` with
`sync_cycle_atomic`. These commit authoritative rows and the pull checkpoint
together; separate stores retain idempotent page replay.

The reference PostgreSQL server now supplies the complementary database-side
path: an `AFTER`-row `syncer_protocol_capture_change()` trigger can register
arbitrary tenant/id/JSON column names—or a deliberately reviewed whole row—in
the canonical record mirror and ordered pull log. This closes the earlier
single-demo-table limitation, but deployment is still explicit: each
authoritative table must attach the trigger (or use WAL/logical decoding or a
mandated write service), and source-table RLS does not automatically protect
the mirror/change log.

## Supabase specifics (verified against current docs, July 2026)

Supabase has **no first-party offline sync engine**. Its own position (GitHub
discussion #357, the org's most-upvoted) is "continue to use these tools" —
PowerSync, ElectricSQL, WatermelonDB, RxDB, Replicache, Legend-State. Plan
accordingly: you are assembling a sync engine, not enabling a feature.

Four findings that should shape any Supabase integration:

**1. Realtime does not guarantee delivery — treat it as a hint, never as the
log.** From the Supabase Realtime team (May 2026): *"If a client disconnects for
30 seconds and reconnects, the changes that happened during those 30 seconds are
gone. Realtime does not queue them and does not track how far each client has
read."* It is documented as best-effort, on temporary replication slots that stop
capturing when no client is subscribed. So: subscribe, then run a cursor-based
catch-up query, and re-run that catch-up on **every** reconnect. RxDB formalizes
this as a `RESYNC` event.

Worse, `SUBSCRIBED` is not a readiness barrier — supabase-js #1599 reports the
client emits it before the replication listener is streaming, so writes in a
1–3 second window are silently missed. That issue was closed by a stale bot, not
fixed.

Supabase also now recommends **Broadcast** over Postgres Changes, because
Postgres Changes *"authorizes every event against each subscriber"* and is
*"processed on a single thread"* — throughput scales with subscriber count, not
write rate, and they suggest switching beyond ~3,000 subscribers.

**2. A `updated_at > cursor` pull loses writes, and Supabase's own tutorial has
the bug.** Sequence values and `now()` are assigned at transaction *start* but
rows become visible at *commit*, so a lower-valued row can appear after you have
already advanced past it — and it is then invisible forever. Supabase's official
WatermelonDB tutorial filters `last_modified_at > _ts` and returns `now()` as the
next cursor, which exhibits exactly this. `moddatetime` makes it *more* likely,
since it stamps transaction-start time.

The correct fix is a commit-order gate:

```sql
ALTER TABLE outbox ADD COLUMN transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id();

SELECT ... FROM outbox
WHERE ((transaction_id = $last_txid AND position > $last_pos)
       OR transaction_id > $last_txid)
  AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY transaction_id, position;
```

`xid8` is 64-bit, so it also avoids `xmin`'s 32-bit wraparound. Cheaper
mitigations: lag the watermark and dedupe by primary key, or use a composite
`(timestamp, id)` cursor — but note that only fixes *ties*, not commit ordering.

**3. RLS breaks sync in three distinct ways.**

- **Logical replication is not RLS-filtered per change** — Postgres checks
  privileges once per replication connection. Every WAL-based engine reimplements
  authorization above the stream; PowerSync literally creates a `BYPASSRLS` role.
- **Deletes are invisible**, and in Realtime *"RLS policies are not applied to
  DELETE statements"* — the old record is broadcast to all subscribers of that
  table, so your replica identity must contain nothing private.
- **Move-out is unobservable.** When a row leaves your scope, an RLS-filtered
  read simply returns nothing, indistinguishable from "unchanged". WatermelonDB
  states the rule to follow: a grant must appear in the feed as `created`, a
  revoke as `deleted`, **including descendants**.

Note the asymmetry PowerSync ships with: the download path bypasses RLS (using
sync rules as the filter) while the upload path goes through RLS. That means two
authorization definitions you must keep in agreement by hand.

**4. Auth is not immediate.** `auth.jwt()` is only as fresh as the token, so a
permission change does not take effect until refresh. On Realtime, permissions
are computed at connect and cached for the connection's life — *"If a new JWT is
never received on the Channel, the client will be disconnected when the JWT
expires"* — so revocation is not immediate on an open channel. Push refreshed
tokens explicitly with `setAuth()`; the related token-refresh issues were also
closed as stale rather than fixed.

Also worth knowing: replication slots are a **scarce, non-configurable** resource
on Supabase, they require a direct (non-pooled, IPv6-unless-you-pay) connection,
and each of Realtime, Pipelines, and every sync engine consumes one.

## The structural limit: intent is erased

This is not a bug to patch, and it is the most important paragraph here.

By the time a change is "a JSON document with an `updatedAt`", the information
*"the user pressed +1"* has already collapsed into *"the value is 7"*. Two
offline clients each incrementing 5 will merge to 6, and no timestamp discipline
recovers the 7. Zero/Replicache can express this because what crosses the wire is
a **function call** the server re-executes; a merge engine cannot.

Decide explicitly whether your domain contains non-LWW intent — counters, list
membership, guarded state transitions, uniqueness, allocation. If it does, put
those operations behind ordinary server endpoints and let opto-sync reconcile the
rest.

Worth knowing: **Electric shipped a CRDT-based engine, from the team that
invented rich CRDTs for Postgres, and abandoned it in 2024** for tentative writes
with server authority — not because the theory failed but because the stack was
too complex to keep stable. Server authority buys arbitrary business logic; CRDTs
buy no-rollback. Nobody has both.

## Where this design is genuinely ahead

- **Schema migration.** PowerSync's *"the client-side schema is applied to the
  schemaless data, meaning no migrations are required"* is the best migration
  story of the surveyed engines, and it works precisely because the store is JSON
  documents. A JSON-document merge engine inherits that: add a field, drop a
  field, change a type, no client migration, old clients degrade gracefully.
- **Per-element identity inside arrays.** `MERGE_BY_KEY` matches array elements
  by identity with per-element timestamps, so a concurrent edit to element A and
  element B of the same array does not clobber either. Naive deep merge either
  replaces the whole array or unions it; Triplit needed real CRDT sets to get
  here.
- **Resolution is per node, all-or-nothing**, not per leaf. A write group sharing
  one `updatedAt` is accepted or rejected as a unit, so you do not get the
  classic per-field artifact of `{status: "cancelled", shippedAt: …}` — a
  document no client ever wrote. Keep related fields under one timestamped node
  to preserve this.
- **One engine, five languages, byte-identical.** No surveyed engine offers this;
  most are single-runtime. It is what makes a Dart device, a browser tab, and a
  Rust service agree by construction rather than by convention.

## Recommended shape for an adopting application

1. Keep **two layers**: an immutable synced store and a pending-writes store,
   merged on read. Never merge optimistic writes into the synced copy in place.
2. Write the optimistic row **and** its queue entry in **one transaction** —
   every surveyed engine does this, several via database triggers.
3. Let the client's HLC stamp `updatedAt`; let the **server** stamp `syncedAt`.
4. Give the server a per-client monotonic watermark, committed atomically with
   the effect, and use it to drop acknowledged writes.
5. Pull with a **commit-order** cursor, not a timestamp.
6. Ship a checksum-or-version divergence check and a reset path that re-applies
   pending writes.
7. Return 2xx for permanently-invalid writes so the queue drains; reserve errors
   for transient failures.
8. Route non-LWW intent (counters, membership, guarded transitions) through
   ordinary endpoints.
