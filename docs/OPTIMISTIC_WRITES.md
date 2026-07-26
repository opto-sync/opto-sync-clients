# Optimistic writes: the client-side contract

`syncer.c` answers one question — *given two versions of a document, what is the
merged result?* It is a pure function with no clock, no storage, and no notion of
a queue.

Everything else an optimistic-write client needs lives here, and this document
is the contract for it. The short version:

> **Render `localView`, not `reconcileIncoming`.**

## The loop

```
  user edit ──▶ queueMutation ──▶ [ pending queue ]
                     │                    │
                     │                    ├──▶ push ──▶ server ──▶ confirmSyncedUpTo
                     ▼                    │
                 local write              └──▶ replayed on top of ▼
                                                        server pull ──▶ localView ──▶ UI
```

1. **Queue the write.** `queueMutation` stamps `updatedAt` from a hybrid logical
   clock and persists the mutation (IndexedDB via Dexie, SQLite via Drift, or
   first-party SQLite / your own store in Rust).
2. **Push at-least-once.** Every mutation carries `(clientId, mutationId)`.
3. **Pull server state**, then **rebase**: replay every un-confirmed mutation on
   top of it. That result is what the UI renders.
4. **Confirm.** The server reports the highest `mutationId` it has durably
   applied for this client; `confirmSyncedUpTo` drops everything at or below it.

### Make the local row and queue one commit

When the rendered application row and queue share a database, do not write the
row and then call `queueMutation` as two independent commits. TypeScript
provides `queueMutationAtomic` / `queueDeleteAtomic` for tables in the client's
Dexie database; Dart provides the same pair for writes issued through the
client's Drift connection. A callback failure, quota refusal, or queue failure
rolls both effects back, and only a successful commit wakes the background
loop.

Rust defaults to `SqliteProtocolStore`; its `queue_upsert_with` and
`queue_delete_with` callbacks put application SQL in the queue transaction.
`MutationStore`, `ProtocolQueuePersistence`, and `AtomicProtocolSyncStore`
remain alternate seams. If stores cannot share a transaction, keep the queue
as the durable source of optimistic intent and derive the UI with `localView`;
do not destructively overwrite the synced base.

## Why rebase is not optional

This is the part that is easy to get wrong, and the failure is invisible until a
user is unlucky.

`reconcileIncoming` reconciles two documents. It knows nothing about mutations
still waiting to be pushed. So if a pull brings server state whose `updatedAt` is
newer than a queued local edit — which happens whenever anyone else touched the
record, or the server stamps its own time — last-write-wins rejects the local
edit as stale and it **disappears from the view while still sitting in the
queue**. Moments later the push lands, the server accepts it, the next pull
brings it back, and the user watches their own work undo and redo itself.

Rebase removes the window: server state is the base, un-confirmed local writes
are replayed on top, and the record only settles on server truth once the server
has actually confirmed it.

The test that pins this asserts both halves:

```js
const withoutRebase = reconcileIncoming(server, pending);
assert.strictEqual(withoutRebase.title, 'server title');   // the bug

const view = rebasePending(server, [pending]);
assert.strictEqual(view.title, 'my un-pushed edit');       // the fix
```

### The overlay is not timestamp-gated

Engines that replay *mutator functions* (Replicache, Linear) get rebase for
free — a function re-run against new state simply produces new state.

opto-sync replays *documents* through a last-write-wins merge, so a naive replay
reintroduces the exact bug rebase exists to prevent: the pending edit is older,
so the merge rejects it again. The overlay therefore runs with
`resolveByTimestamp: false`.

That is not a weakening of conflict resolution. Pending mutations are **this
client's own latest intent**, not a concurrent writer to arbitrate against. The
queued payloads are never modified, and authority still rests entirely with the
server: whatever it decides arrives on the next pull, and once it confirms, the
overlay for that mutation is gone.

Pass `gateOverlayByTimestamp: true` (TS) or the equivalent flag (Rust/Dart) to
opt into strict gating, accepting that a pending write older than the server's
timestamp will vanish from the view until its push lands.

## Why mutations carry `(clientId, mutationId)`

Push is at-least-once: a request that times out may still have been applied. On
retry, a server with no way to recognise the replay applies it twice — which for
a merge-based engine can resurrect a field the user has since cleared.

So every mutation carries a stable per-install `clientId` and a monotonic
`mutationId`. The HLC node id derives from that device id but adds a
per-instance suffix so concurrent tabs/processes cannot emit equal timestamps.
The
server records the highest it has applied per client and ignores anything at or
below it. This is the same `lastMutationID` watermark Replicache uses.

The sequence is allocated **inside the same transaction** as the enqueue. Two
concurrent `queueMutation` calls that each read-then-wrote the counter could
otherwise hand out the same id, and a server deduping on `(clientId, mutationId)`
would silently drop the second write.

## Ordering

`pendingMutations` returns **insertion order**, explicitly sorted. Two edits to
one record replayed backwards show the older value. It is also the order the
mutations will reach the server, so the view matches what the server will end up
with.

## Timestamps

Local writes are stamped from a **hybrid logical clock**, persisted across
reloads, with a node id generated once per install:

- A wall clock makes last-write-wins a function of device clock skew — a device
  running fast wins every conflict forever, and a clock that steps backwards
  makes its own edits vanish.
- `observeIncoming` advances the clock past timestamps seen from the server, so
  this client's next write is ordered after everything it has already observed.
- `createdAt` is deliberately **not** stamped: it is first-write-wins and belongs
  to whoever created the record.

Use one timestamp format per key across every replica. The core compares
fixed-width ISO-8601 strings lexicographically and integers numerically; mixing
formats across replicas compares lexicographically and is not chronologically
meaningful.

## What is still yours to build

The HTTP transport remains application-specific: endpoint URLs,
authentication/token refresh, and installation of authoritative rows live
outside the SDK.

TypeScript and Dart now ship `ProtocolSyncLoop` for the correctness-sensitive
orchestration around that transport. They catch up before pushing, snapshot
and acknowledges immutable batches, catches up again, installs retention-reset
snapshots before their checkpoint, coalesces concurrent work, and backs off
transient failures. Attach `ProtocolSyncLoop.hint()` with
`setBackgroundSyncTrigger()` so a committed local mutation wakes it. Realtime
or WebSocket notifications should call the same hint; they never replace a
checkpointed pull.

Rust exposes the same cycle as runtime-neutral `ProtocolSyncDriver`, including
an explicit durable queue persistence callback.

For a shared local database, TypeScript's
`applyChangesAndCheckpoint` / `replaceAuthoritativeAndCheckpoint`, Dart's
`AtomicProtocolSyncCallbacks`, and Rust's `sync_cycle_atomic` commit
authoritative rows and their checkpoint together. If the app store cannot
transact with queue metadata, callbacks must apply pull pages idempotently: a
crash after applying changes but before checkpoint persistence replays that
page. Snapshot replacement must be atomic. Platform lifecycle integration and
concrete transport remain the integrator's responsibility.

## Prior art

The rebase-on-pull and `lastMutationID` watermark are the shapes
[Replicache](https://doc.replicache.dev/concepts/how-it-works) settled on, and
Linear's sync engine works the same way. The difference here is that opto-sync
reconciles documents through a shared C core rather than replaying mutator
functions, which is what makes the un-gated overlay necessary rather than
incidental.

## Sources

- [How Replicache Works](https://doc.replicache.dev/concepts/how-it-works)
- [Replicache — Local Mutations](https://doc.replicache.dev/byob/local-mutations)
- [Replicache — Push Endpoint Reference](https://doc.replicache.dev/reference/server-push)
