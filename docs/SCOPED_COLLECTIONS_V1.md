# Fixed-membership scoped collections (experimental v1)

This is a narrowly scoped read projection pilot motivated by Electric/Phoenix.Sync
shapes, LiveView subscriptions, and TanStack Query/DB collections. It is NOT a
claim of server-side filtered replication or TanStack DB integration yet.

## API

The additive TypeScript API is exported by @opto-sync/reactive:

    import { createScopedCollection } from '@opto-sync/reactive';

    const collection = createScopedCollection({
      sessionPartition: verifiedSessionGeneration,
      scope: { version: 1, table: 'docs', recordIds: ['doc-7', 'doc-8'] },
      // Must atomically commit authoritative rows + checkpoint in host store.
      persist: (rows, checkpoint) =>
        localStore.transaction(() => localStore.replaceScopedRowsAndCheckpoint(
          collection.scopeKey, rows, checkpoint,
        )),
      // Reuse the existing durable queue and localView projection.
      projectLocalView: (id, authoritative) =>
        appSyncClient.localViewFor(id, authoritative),
    });
    const unsubscribe = collection.subscribe((view) => render(view.rows));
    await collection.installSnapshot(snapshot);
    await collection.applyPullPage(page);
    // Or call syncScopedCollectionOnce(collection, {baseUrl, headers}) to
    // fetch a snapshot and bounded authoritative pull pages over HTTP.
    collection.notifyLocalChange();
    // Following RESET_REQUIRED:
    await collection.requireSnapshot();
    // Fetch/install a consistent new snapshot.

localStore.replaceScopedRowsAndCheckpoint, appSyncClient.localViewFor, and
render above are application-supplied pseudocode, NOT SDK exports.

## Contract and limitations

- Only explicit ID sets of 1–128 records in one registered logical table are
  accepted. IDs are sorted and deduplicated by a canonical scope function.
- A scope key includes the session generation, table, and ID set. This value
  contains identity/record information: DO NOT log or broadcast it.
- A new tenant, user, session, authorization policy, or scope selection must
  create a new collection/store partition. The host persistence callback must
  fence stale session generations.
- The server must authorize the requested table and every record, and must
  repeat authorization at snapshot and every pull. Client-side filtering does
  not provide authorization.
- The server must bind each snapshot and pull to the exact scope and return a
  commit-ordered checkpoint. Skipping irrelevant global commits is safe only
  when derived from one consistent server snapshot of the log.
- The first snapshot replaces the scoped authoritative base; each pull applies
  ordered updates/deletes to that base. An ID outside the fixed scope is rejected.
  Absence of an ID from a pull page is not a deletion.
- Persistence is host-supplied and optional. Without it the collection is
  memory-only; a successful method call is not a durability guarantee.
  If persistence fails, the in-memory head does not advance and a retry may
  repeat the same page.
- Pending optimistic writes belong to the existing per-client durable mutation
  ledger. The projection callback reads its current local view; the collection
  never acknowledges, reorders, or drops mutations.
- requireSnapshot invalidates the in-memory authoritative projection and does
  not delete pending queue entries. The host snapshot replacement must commit
  together with the new checkpoint before another pull page is accepted.
- Untrusted responses are checked for canonical decimal revisions, exact scope
  identity, in-order changes, and bounds. Current v1 does not support arbitrary
  predicates, columns, SQL, joins, TanStack DB integration, push mutation
  transactions, or full cross-runtime parity.

## Server companion and integration follow-up

An experimental server companion is staged in opto-sync/opto-sync-e2e PR #67.
It implements POST /v1/sync/scopes/snapshot and /v1/sync/scopes/pull.
The client now validates the server-issued scopeToken, which binds the server-
verified subject/tenant to the exact canonical ID set; retain it in the memory
projection and request a new snapshot after process restart. A matching server-
owned scoped snapshot and pull source uses the
existing tenant-authenticated Postgres protocol state and commit log, with
existing tenant-level authorization and bounded payloads. Deployment-specific
record-level authorization must be added before using it with ACL-protected rows. Carry scopeKey and
fromCheckpoint on every response. Use actual Postgres isolation to test
snapshot racing with a commit, pagination, retention reset, authorization
revocation, and server-side filtering. The injected HTTP transport adapter syncScopedCollectionOnce does this for the
reference server. It does not continuously poll, start a WebSocket, or connect
TanStack DB itself; applications own scheduling, wake hints and cancellation.

For TanStack DB, wrap its collection sync lifecycle in an adapter that receives
these pages but continues to use Opto Sync's pending mutation ledger as the
authoritative optimistic overlay. Never treat a WebSocket wake hint as a
checkpoint or mutation acknowledgement.

Pilot tests from repository root:

    node --experimental-strip-types --test clients/reactive-ts/test/scoped-collection.test.ts
