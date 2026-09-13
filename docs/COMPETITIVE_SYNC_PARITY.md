# Competitive sync parity

This document is the human-readable companion to
`conformance/competitive-sync-parity.v1.json`. The JSON file is the canonical
claim ledger; CI validates its shape and evidence requirements.

“Parity” here means **behavioral capability parity**, not cloning another
library's API or architecture. Opto Sync remains a deterministic offline-first
replication/protocol engine whose first-class durable local stores are IndexedDB
and SQLite. A competitor feature only belongs here when it exposes a useful
correctness or product guarantee that Opto Sync should either implement or
explicitly decline.

## 2026 baseline

The foundations are already strong:

- durable optimistic mutation state in IndexedDB/SQLite;
- immutable mutation identity and exact acknowledgement;
- strict remote-acknowledged, write-through local-first, and queued local-first
  consistency policies;
- authoritative base plus ordered optimistic/rejected/transformed overlay;
- commit-ordered opaque pull checkpoints, tombstones, reset/snapshot/rebase,
  bounded paging, retry and reconnect orchestration;
- service-worker/multi-tab ownership work on web and restart-safe SQLite work on
  desktop/mobile;
- shared cross-runtime consistency fixtures and formal/parity lanes.

Those capabilities map well to Linear's local-first foreground model and durable
transaction queue. Linear's August 2026 delta-sync write-up reinforces the
correct direction: clients keep a local database, return with an ordered
checkpoint, receive only relevant changes, and apply permission/subscription
filters while preserving an authoritative ordered head.

## Current gaps that block a strong parity claim

### Authoritative caught-up barrier

`OptoSyncClient` persists a pull checkpoint and supports atomic
change+checkpoint commits, but application code cannot yet ask the protocol for
“the authoritative source position as of now” and wait until durable local state
has reached that position.

That distinction matters. `idle`, “socket connected”, “first sync finished”,
and “local data includes everything relevant through authoritative checkpoint
X” are different statements. PowerSync's 2026 Checkpoint Requests make this a
first-class API; Opto Sync should provide the transport-neutral semantic rather
than asking applications to infer freshness from scheduler state.

Required behavior:

- request or receive an authoritative checkpoint token representing a source
  position;
- drive/wake the normal checkpointed sync loop;
- resolve only after the durable local checkpoint reaches the target;
- type timeout, cancellation, offline, reset and authorization failure;
- expose equivalent semantics in TypeScript/IndexedDB, Dart/SQLite and
  Rust/SQLite.

### Selective / partial sync scopes

Linear's newest delta path performs access and subscription filtering over an
ordered action range before expensive payload enrichment. PowerSync Sync Streams
and Electric Shapes likewise make scoped/partial replication explicit.

Opto Sync needs a versioned scope/subscription contract if it wants comparable
large-workspace and view-driven behavior. A scope must have stable identity and
parameters, checkpoint state must be bound to that identity, and changing scope
must never reinterpret “not in this subscription” as a deletion.

Required behavior includes safe subscribe/unsubscribe, cache retention policy,
tenant/authorization transitions, scope expansion/contraction, and server-side
routing metadata that can reject irrelevant changes before payload hydration.

### Optimistic application transactions

Opto Sync already has same-store atomic “application row + queue intent” writes
and immutable push batches. That is not automatically the same thing as a
multi-record application transaction.

TanStack DB exposes optimistic transaction semantics and PowerSync groups CRUD
operations into transactions. Opto Sync should explicitly separate transport
batch identity from optional application transaction/group identity, then define
exact confirmation/rejection/transformation/rollback behavior for the group.
Unrelated pending work must survive a rejected transaction.

### Portable conflict-policy extensibility

The current merge surface has useful deterministic LWW/FWW/array policy knobs.
RxDB goes further with arbitrary custom conflict handlers, but copying that API
would be dangerous for a library whose differentiator is cross-runtime parity.

The acceptable parity target is either:

1. a versioned policy registry/algebra whose identifiers and fixtures replay
   identically in every supported runtime; or
2. an explicit capability boundary that rejects arbitrary custom policies and
   documents the portable strategies Opto Sync guarantees.

Do not claim generic CRDT, OT, causal consistency, or order independence beyond
what formal/runtime evidence proves.

## Comparator set

The claim ledger tracks Linear, PowerSync, RxDB, TanStack DB and LiveStore. The
most useful ideas to preserve are:

- **Linear:** foreground local DB, durable local intent, ordered delta checkpoint,
  access/subscription-aware catch-up, replay-safe authoritative head.
- **PowerSync:** local SQLite, selective streams, durable upload state, explicit
  checkpoint requests.
- **RxDB:** IndexedDB-first replication, checkpoints, one replication leader,
  explicit conflict-policy surface.
- **TanStack DB:** immutable synced base plus optimistic overlay, transaction
  lifecycle and rollback, wait-for-sync-back behavior.
- **LiveStore:** reactive SQLite as an application data layer and explicit local
  state/sync observability; its event-sourcing architecture is informative, not
  a requirement for Opto Sync.

## Release rule

A capability must not move to `implemented` merely because a document says it
exists. The parity manifest requires evidence, and the release/certification
lanes should eventually require all of the following for strong claims:

1. a public API or protocol contract;
2. deterministic fixtures/state-machine coverage;
3. runtime evidence in each claimed primary runtime/store;
4. real IndexedDB/SQLite lifecycle coverage where the behavior depends on the
   storage engine or process/browser lifecycle.

The manifest intentionally keeps missing and partial capabilities visible. It is
better to publish an exact gap than to claim “local-first parity” while freshness,
partial replication or transaction semantics are still application-defined.
