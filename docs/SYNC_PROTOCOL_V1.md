# opto-sync protocol v1

Status: reference contract for the opto-sync clients and PostgreSQL server.

This protocol moves mutations and authoritative changes. The C core still owns
only reconciliation; it does not perform I/O, authorize a write, allocate a
checkpoint, or acknowledge delivery.

## Invariants

1. A client has a stable `clientId` and allocates strictly contiguous positive
   decimal `mutationId` values.
2. `(clientId, mutationId)` identifies immutable mutation content. Reusing the
   identity for different content is a protocol error.
3. The server commits the mutation ledger row, client watermark, record effect,
   and pull-log entry in one database transaction.
4. A successful retry returns `duplicate` with the original result. It never
   applies the effect twice.
5. Permanent rejection is also recorded and advances `lastMutationId`; a poison
   mutation cannot block the queue forever.
6. Pull checkpoints order database commits, not device timestamps or sequence
   values allocated before commit.
7. Deletes are explicit tombstones. Absence is never interpreted as deletion.
8. A client behind retained history receives `RESET_REQUIRED`, installs one
   consistent snapshot, then rebases still-pending local mutations.
9. Snapshot replacement completes before its checkpoint advances. If
   replacement fails or the process exits first, the old checkpoint and every
   pending mutation remain, so the complete snapshot can be retried.

All identifiers and revisions are decimal strings on the wire. JavaScript
numbers cannot represent every PostgreSQL `bigint`.

## Push

`POST /v1/sync/push`

```json
{
  "protocolVersion": 1,
  "clientId": "device-a.tab-1",
  "mutations": [
    {
      "mutationId": "1",
      "operation": "upsert",
      "table": "docs",
      "recordId": "doc-42",
      "baseRevision": "7",
      "payload": {
        "title": "local edit",
        "updatedAt": "1721822400000-0000-device-a.tab-1"
      }
    }
  ]
}
```

Operations:

- `upsert` requires an object `payload`.
- `delete` must not carry a payload.
- The reference server accepts protocol pushes only for the `docs` logical
  table. Other registered PostgreSQL tables are currently download/capture
  sources; writing them requires an application endpoint, direct SQL, or a
  deployment-specific mutation handler.
- `baseRevision` is optional for a merge into a live record. Use `"0"` when a
  create must fail if the record already exists.
- Resurrecting a tombstone requires `resurrect: true` and the tombstone's exact
  `baseRevision`. This makes resurrection explicit rather than a timestamp
  accident.

The whole push is one database transaction. Mutations are processed in request
order and must continue directly after the server's per-client watermark.
Protocol v1 deliberately has no cross-request transaction identifier: a client
transaction that must be atomic must fit in one push batch. A later protocol
version can add explicit group size/index semantics without pretending that an
uninterpreted label provides atomicity.

```json
{
  "protocolVersion": 1,
  "clientId": "device-a.tab-1",
  "lastMutationId": "1",
  "checkpoint": "91",
  "results": [
    {
      "mutationId": "1",
      "status": "applied",
      "checkpoint": "91",
      "document": {
        "table": "docs",
        "recordId": "doc-42",
        "record": { "title": "local edit" },
        "revision": "8",
        "deleted": false,
        "deletedAt": null
      }
    }
  ]
}
```

Result statuses:

- `applied`: the effect committed, including an acknowledged no-op.
- `duplicate`: the same immutable mutation was already processed;
  `originalStatus` is `applied` or `rejected`.
- `rejected`: a permanent per-mutation outcome such as `REVISION_CONFLICT`,
  `NOT_FOUND`, `TOMBSTONED`, or `UNSUPPORTED_TABLE`. The authoritative record is
  included when available.

Request-level `409` errors (`MUTATION_GAP`, `MUTATION_ID_REUSED`) roll the whole
push back and do not advance the watermark.

## Pull

`GET /v1/sync/pull?checkpoint=0&limit=100`

```json
{
  "protocolVersion": 1,
  "checkpoint": "91",
  "hasMore": false,
  "changes": [
    {
      "checkpoint": "91",
      "table": "docs",
      "recordId": "doc-42",
      "operation": "upsert",
      "record": { "title": "local edit" },
      "revision": "8",
      "source": {
        "clientId": "device-a.tab-1",
        "mutationId": "1"
      },
      "committedAt": "2026-07-25T00:00:00.000Z"
    }
  ]
}
```

`source` is present only when the change came from a protocol mutation.
Trigger-captured administrative, migration, or other direct database writes
omit it; clients must still apply those authoritative changes.

When protocol metadata and authoritative rows share a store, apply the page and
persist its checkpoint in one transaction. Otherwise apply the page
idempotently, persist its checkpoint only after application succeeds, then
render `localView` by replaying pending mutations. A crash in that cross-store
window replays the page rather than skipping it. Continue while `hasMore` is
true.

The shipped coordinators expose both paths. TypeScript atomic callbacks use
`commitPullPageAtomic`, Dart implements `AtomicProtocolSyncCallbacks`, and Rust
uses `AtomicProtocolSyncStore` with `sync_cycle_atomic`. Each same-database path
commits authoritative rows and queue checkpoint together. The default callback
path preserves apply-first/checkpoint-second replay for separate stores.

The reference server uses one global commit-ordered log and filters it by the
authenticated tenant. Consequently, a page with no visible changes may advance
to the server high-water checkpoint, skipping commits belonging to other
tenants. The high-water mark and filtered page are read in one repeatable-read
transaction, so that advancement cannot skip a racing commit. Checkpoints do
not acknowledge pushes; only `lastMutationId` does.

## Reset

When history required by a checkpoint has been compacted, pull returns HTTP 409:

```json
{
  "protocolVersion": 1,
  "error": "RESET_REQUIRED",
  "resetRequired": true,
  "minimumCheckpoint": "90",
  "snapshotUrl": "/v1/sync/snapshot"
}
```

Fetch the snapshot. The snapshot and its checkpoint come from one repeatable-read
database snapshot:

```json
{
  "protocolVersion": 1,
  "checkpoint": "104",
  "records": [
    {
      "table": "docs",
      "recordId": "doc-42",
      "record": { "title": "authoritative" },
      "revision": "9"
    }
  ]
}
```

In one local transaction:

1. replace the synced store with `records`;
2. persist the snapshot checkpoint;
3. leave the pending mutation queue untouched.

Then recompute the rendered view by rebasing pending mutations. Do not merge an
old synced store into the snapshot.

The TypeScript and Dart clients expose `installSnapshot`; Rust exposes
`ProtocolQueue::install_snapshot`. Each validates protocol v1, invokes the
caller's authoritative replacement first, advances the checkpoint only after
that callback succeeds, and leaves the pending queue untouched. The callback
must itself atomically replace the application store: an SDK queue cannot make
IndexedDB, SQLite, a file, or another unrelated store participate in one
cross-store transaction.

For a shared database, use TypeScript `installSnapshotAtomic`, Dart
`installSnapshotAtomic` through `AtomicProtocolSyncCallbacks`, or Rust
`sync_cycle_atomic`; these replace authoritative rows and persist the snapshot
checkpoint in one storage transaction.

The live restart suite injects a replacement failure and exits between server
commit and local acknowledgement. Fresh TypeScript/Chromium, Dart/SQLite, and
Rust/SQLite processes all observe checkpoint `"0"` plus the pending mutation,
retry the snapshot, reconstruct the identical push envelope, receive the
durable `duplicate` result, and persist the acknowledgement. Rust reopens the
SQLite database a second time to prove that acknowledgement survived too.

## Acknowledgement must name the sent batch

Never apply a bare `lastMutationId` watermark. The client must retain the exact
immutable `PushRequest` until the response is validated and require:

1. matching protocol and client identity;
2. `lastMutationId` equal to the last mutation in that request;
3. one ordered result for every requested mutation; and
4. canonical checkpoint/revision encodings.

Otherwise a malformed or compromised response can acknowledge queued mutations
that were never transmitted. TypeScript and Dart therefore require
`acknowledgePush(response, request)`; Rust requires
`ProtocolQueue::acknowledge(&response, &request)`. All coordinators retain and
pass the immutable request automatically.

## PostgreSQL commit ordering

The reference server locks a singleton protocol-state row before changing
records or allocating checkpoints. That serializes protocol commits and makes
`checkpoint` reflect commit order. A PostgreSQL sequence alone is insufficient:
transaction A can allocate 10, transaction B can allocate 11 and commit first,
causing a client that persists checkpoint 11 to miss A forever.

Production systems can replace the singleton with a WAL/LSN-derived stream or
another commit-ordered log, but they must preserve the same observable contract.

Migration 2 adds a canonical `syncer_protocol_records` mirror and a generic
`syncer_protocol_capture_change()` `AFTER`-row trigger function. Applications
attach it to each authoritative PostgreSQL table with logical-table,
tenant-column, id-column, record-column, and optional deletion-column
arguments. The record may be one JSON/JSONB object column or a deliberately
reviewed whole-row object.

Protocol writes and trigger-captured direct SQL writes allocate from the same
locked checkpoint state in the same transaction. Each captured record receives
a protocol-owned monotonically increasing revision; tombstones retain their
revision in the mirror, including physical source-row deletion. Rolling back
the writer also rolls back the source record effect, checkpoint allocation,
mirror revision, and change-log row.

Registration is explicit: an unattached table remains invisible. Whole-row
capture can expose secret columns, and source-table RLS is not inherited by the
mirror/change log, so deployment grants, RLS, record authorization, and table
selection remain application responsibilities. WAL/logical decoding or a
mandated write service remain valid alternatives.

## Compaction

`POST /v1/sync/admin/compact` accepts a decimal `throughCheckpoint`, deletes
change rows through that checkpoint, and advances the retention watermark in
one transaction while holding the same protocol-state lock as writers. A
client behind the new watermark receives `RESET_REQUIRED`; current records and
tombstones are not deleted.

Outside e2e mode this endpoint requires its own
`SYNCER_PROTOCOL_ADMIN_TOKEN` (32–4096 characters). Tenant bearer tokens cannot
invoke it, and the administrator credential cannot invoke the test-only direct
writer. Injected failures after history deletion and immediately before commit
prove that both the deletion and watermark roll back.

## Authorization

Authenticate and authorize the logical `table` and `recordId` before invoking
the merge. A C merge result is not an authorization decision. Hosted Supabase
deployments should enforce RLS in the database-facing path or validate the JWT
and policy in the Edge Function before calling the WASM core.

The Node/PostgreSQL reference server is not an identity provider, but its
production path verifies asymmetric Supabase-compatible JWTs locally and
enforces signed identity bindings. Set this project-specific object in
`SYNCER_PROTOCOL_JWT_JSON`:

```json
{
  "jwksUrl": "https://PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json",
  "issuer": "https://PROJECT_REF.supabase.co/auth/v1",
  "audience": "authenticated",
  "algorithms": ["ES256"],
  "roles": ["authenticated"],
  "tenantClaim": "app_metadata.opto_sync_tenant_id",
  "clientIdsClaim": "app_metadata.opto_sync_client_ids"
}
```

Signature, algorithm, issuer, audience, lifetime, role, subject, tenant, and
exact client claims are validated. Authorization claim paths under
user-editable `user_metadata` are rejected. JWKS transport/key failures fail
closed with 503; they never fall back to decoded-but-unverified claims or
static credentials.

Static mapping remains available for isolated deployments. Configure
`SYNCER_PROTOCOL_AUTH_JSON` as an array:

```json
[
  {
    "token": "a-long-random-secret",
    "subject": "user-123",
    "tenantId": "acme",
    "clientIds": ["device-a.tab-1", "device-a.tab-2"]
  }
]
```

Every `/v1/sync/*` request must carry the corresponding bearer token. The
server derives `subject`, `tenantId`, and allowed client IDs from that token:
wire payloads cannot select their tenant, and a push claiming an unbound
`clientId` receives `CLIENT_ID_FORBIDDEN`. Client ledgers are keyed by
`(tenantId, clientId)` and durably owned by `subject`; records, mutation
ledgers, pull logs, and snapshots are tenant-scoped. Multiple tokens may bind
the same subject/client pair for rotation, but configuration assigning one
pair to different subjects fails closed.

For a single identity, the equivalent legacy environment variables are
`SYNCER_PROTOCOL_BEARER_TOKEN`, `SYNCER_PROTOCOL_SUBJECT`,
`SYNCER_PROTOCOL_TENANT_ID`, and comma-separated
`SYNCER_PROTOCOL_CLIENT_IDS`. Supplying only a shared bearer token is rejected
as incomplete configuration. Explicit e2e mode remains unauthenticated and
supports test-only identity headers.

Tenant isolation does not by itself implement document-level ACLs; enforce
those in the application path or with PostgreSQL RLS. Exact configuration,
claim issuance, signing-key rotation, and adversarial tests are in
[`opto-sync-e2e/docs/AUTHENTICATION.md`](../../opto-sync-e2e/docs/AUTHENTICATION.md).

## Operational controls

The reference Node service enforces configurable exact push-body, per-mutation,
batch-count, snapshot-record, and snapshot-byte limits before state changes.
Quota errors are HTTP 413 with `PUSH_TOO_LARGE`, `MUTATION_TOO_LARGE`,
`PUSH_MUTATION_LIMIT`, or `SNAPSHOT_QUOTA_EXCEEDED`; a snapshot is never
silently truncated.

Authenticated identities and invalid-bearer remote addresses have fixed-window
rate buckets. HTTP 429 includes `RATE_LIMITED`, `retryAfterSeconds`, and
`Retry-After`. The built-in limiter is process-local; multi-replica deployments
must use a trusted ingress or shared limiter.

`GET /metrics` requires an independent production bearer token and emits
bounded-cardinality Prometheus series. Security and transaction events are
newline-delimited `opto_sync.audit.v1` JSON with request IDs and hashed
correlation identities, never tokens, payloads, or raw record identifiers.
Configuration defaults, series names, tests, and scaling guidance are in
[`opto-sync-e2e/docs/OPERATIONS.md`](../../opto-sync-e2e/docs/OPERATIONS.md).

Protocol-aware SDK queues also bound local admission before sequence
allocation: 10,000 pending mutations and 255 KiB of UTF-8 payload by default,
both configurable. Confirmed-history pruning never removes pending work. See
[OFFLINE_QUEUE.md](OFFLINE_QUEUE.md) for the cross-language API and failure
contract.
