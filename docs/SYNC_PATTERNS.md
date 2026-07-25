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

## The one pattern every engine shares, which we do not

Five out of five surveyed engines keep **two local layers** and merge them on
read:

| Engine | Synced layer | Pending layer |
|---|---|---|
| PowerSync | `ps_data__*` | `ps_crud` (FIFO upload queue) |
| Electric (through-the-DB pattern) | `todos_synced` | `todos_local` + a `changes` log |
| Replicache / Zero | Client View | pending mutation list |
| Triplit | cache | outbox |
| Linear | IndexedDB-backed store | in-memory optimistic layer |

Nobody merges an optimistic write destructively into the synced copy. Keeping
them separate is what makes it possible to:

- show the user which fields are still unconfirmed (Triplit exposes querying
  each layer separately as a first-class feature);
- roll back **one** rejected write while keeping the other nine;
- re-apply pending writes after a forced resync;
- distinguish "the server has not sent me this yet" from "I wrote this and it
  has not gone up yet".

**opto-sync has no local read model at all.** `OptoSyncClient` is a queue plus a
pure `reconcileIncoming` function; your application owns its own store. So today
*you* must implement the two-layer split. Do it — do not merge optimistic writes
into your synced cache in place.

Note this is separable from mutation *replay*: PowerSync has the pending layer
without any rebase engine. You can take the layer and skip the replay.

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

## Gaps you must fill yourself

Ordered by how much damage they cause. None of these require adopting mutation
replay.

### 1. No server-issued acknowledgment watermark

`syncedAt` is a *client-side belief*, not a server commitment — and beliefs are
wrong after a timeout, a retry, or a crash between "server committed" and
"client recorded it". Replicache's rule is the one to copy: a per-client,
monotonic `lastMutationID`, and *"the effects of a mutation and the corresponding
update to the `lastMutationID` must be revealed atomically by the datastore"*.
PowerSync ships a per-client incrementing op id for the same reason.

You may be tempted to argue that a deep merge is idempotent so retries are
harmless. **It is not, for any non-LWW field.** Counters, `attempts++`, list
append, "add this member", "only transition if currently pending" — a retry
doubles the effect. If your documents contain any such field, you need the
watermark.

### 2. No pull protocol, and `updatedAt > lastSyncedAt` is not a valid cursor

A transaction that takes its timestamp at T1 but commits at T3, racing one that
commits at T2, is invisible to a `> T2` cursor **forever**. Every surveyed engine
uses a commit-order watermark instead: Electric's log offset (LSN-derived),
PowerSync's `op_id` + checkpoint, Replicache's opaque orderable cookie. Use a
monotonic sequence or LSN, not a timestamp.

### 3. No divergence detection and no reset path

If you cannot tell you have diverged, you diverge silently and permanently.
PowerSync computes per-bucket checksums and drops a bucket on mismatch; Electric
returns HTTP 409 `must-refetch`; Replicache has a `clear` patch and
`ClientStateNotFound`. Implement all four steps: detect, wipe, refetch, and
**re-apply pending** — the last is only possible with a pending layer.

### 4. Rejection is not modelled

Deep merge is a total function: it always returns an answer, so there is no
natural place for "the server said no" (permissions, RLS, validation). Two rules
worth copying:

- A **permanently invalid** write must be acknowledged and dropped, not retried
  forever. Replicache: mark it processed and increment the watermark anyway.
  PowerSync: return 2xx for validation errors, reserve error responses for
  transient failures — otherwise one poison-pill write blocks the queue.
- Our reference server returns 409 on lost CAS races, which means "nothing was
  written, retry" — treat that as transient, not as rejection.

### 5. Deletes have no representation in a merged document

A timestamp cannot express "this is deleted", and absence is ambiguous between
"deleted" and "not yet synced to me". Every surveyed engine carries deletes as
explicit operations, and PowerSync had to write down *"deletes always win"*. Our
reference server implements tombstones with delete-vs-update resolution
([SERVER_GUIDE.md](../../opto-sync-e2e/docs/SERVER_GUIDE.md)); the client and
merge layers do not. You need tombstones, a retention policy, and an answer for
a client that was offline longer than that retention — otherwise it resurrects
rows.

Within an array, `MERGE_BY_KEY` cannot express element *removal*: unmatched base
elements are kept by design, so a removal looks like "the other side just didn't
mention it". Mark elements deleted with a field rather than omitting them.

### 6. Sync metadata lives inside the merged document

`syncedAt` is in the default LWW key list, which means bookkeeping sits in the
same JSON the merge engine reads and can be clobbered by — or can win against —
a peer's stale value. Every surveyed engine keeps sync metadata strictly outside
user data. Consider dropping `syncedAt` from `lwwKeys` and tracking it beside the
document.

### 7. No transport and no background flush

`triggerBackgroundSync()` is deliberately an empty hook. You supply the loop:
single-flight, exponential backoff with jitter, online/offline detection, and
draining in queue order. `opto-sync-e2e/test/clients/` has a working reference
flush against the reference server.

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
