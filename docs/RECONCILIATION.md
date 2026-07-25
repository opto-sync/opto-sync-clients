# Reconciliation

Reconciliation is the pure part: given the payload you already have locally
(the **base**) and a payload arriving from the server (the **incoming**), produce
the merged document. No clock, no I/O, no hidden state — "which write is newer" is
decided solely by timestamp fields present *in the documents*.

The rules themselves live in
[`syncer.c/docs/MERGE_SEMANTICS.md`](../../syncer.c/docs/MERGE_SEMANTICS.md)
(core **v0.2.1**), which is authoritative. This page covers what a client
integrator has to decide: the policy the clients apply, how to shape documents so
that policy converges, and how failures surface.

## The default policy is a cross-tier contract

Every client **and** every opto-sync server applies exactly this:

| Option | Value | Meaning |
| --- | --- | --- |
| `arrayStrategy` | `MERGE_BY_KEY` (`4`) | array elements matched by identity, matched pairs deep-merged |
| `arrayMatchKeys` | `"id"` | the identity key |
| `resolveByTimestamp` | `true` | timestamp resolution on |
| `lwwKeys` | `"updatedAt,syncedAt"` | Last-Write-Wins |
| `fwwKeys` | `"createdAt"` | First-Write-Wins |

| Client | Where it is declared |
| --- | --- |
| ts | `DEFAULT_RECONCILE_OPTIONS` in [`clients/ts/src/reconcile-core.ts`](../clients/ts/src/reconcile-core.ts) |
| dart | `FfiSyncer` constructor defaults in [`clients/dart/lib/opto_sync_client.dart`](../clients/dart/lib/opto_sync_client.dart) |
| rust | `impl Default for ReconcileOptions` in [`clients/rust/src/lib.rs`](../clients/rust/src/lib.rs) |

### Why uniformity across tiers matters

The merge runs in more than one place: in the browser tab, on the device, and
again on the server when the mutation is applied. If any tier used different
options, the *same* pair of payloads would produce *different* documents
depending on where it was merged — replicas that never converge, and data loss
that only reproduces on one platform.

`arrayStrategy` is the specific trap. The engine's own default is `REPLACE`, under
which an incoming array **discards local elements the server never saw and applies
elements the timestamp guard should have rejected**, because element-level
resolution only happens under `MERGE_BY_KEY`. The clients therefore set it
explicitly rather than inheriting it.

This is pinned in
[`clients/ts/test/reconcile.test.js`](../clients/ts/test/reconcile.test.js) by the
test *"defaults: mergeByKey on id, updatedAt/syncedAt LWW, createdAt FWW"*, whose
comment states the contract outright:

> These defaults are a cross-tier contract: the Dart client, the Rust client, and
> every opto-sync server use exactly this policy. Changing any value here makes
> the same document reconcile differently per platform.

The same object is re-asserted at three more points, so a drift cannot slip
through one tier: `engine-parity.test.mjs` (native **and** wasm),
`browser-fallback.test.mjs`, and inside real Chromium in `browser-e2e.test.mjs`.
The next test in `reconcile.test.js` — *"default strategy protects local array
elements the server has not seen"* — is the regression guard for the `REPLACE`
defect itself. Across the tiers, the live-server suite
[`opto-sync-e2e/test/clients/`](../../opto-sync-e2e/test/clients/) asserts the
same values against the server's own policy (test `0` in each language).

Overriding is per client or per call, and merges over the defaults:

```ts
new OptoSyncClient({ arrayMatchKeys: 'uuid,id' });          // client-wide
client.reconcileIncoming(t, id, incoming, local, { arrayStrategy: 0 });  // one call
reconcileIncoming(local, incoming, { resolveByTimestamp: false });       // pure fn
```

`undefined` and `''` are **different requests**: the core reads an absent
`lwwKeys` as "use my default" and an absent `arrayMatchKeys` as `"id"`, whereas
`''` means "no keys at all". Do not normalize with `x || ''`.

## Worked example: a jsonb array of records

Local state has two items; the server sends one **stale** element, one **fresh**
element, and one **new** element, out of order. Run with the default policy.

```js
const local = {
  id: 'list-1',
  items: [
    { id: 'a', text: 'milk',  qty: 2, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-24T11:59:00Z' },
    { id: 'b', text: 'bread', qty: 1, createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-10T00:00:00Z' },
  ],
};

const incoming = {
  id: 'list-1',
  items: [
    { id: 'b', qty: 3,               updatedAt: '2026-07-24T09:00:00Z' },   // fresh
    { id: 'a', text: 'STALE milk',   updatedAt: '2026-07-20T00:00:00Z' },   // stale
    { id: 'c', text: 'eggs', qty: 12, createdAt: '2026-07-24T09:30:00Z',
                                      updatedAt: '2026-07-24T09:30:00Z' },  // new
  ],
};

reconcileIncoming(local, incoming);
```

Actual output (not predicted — produced by running it):

```json
{
  "id": "list-1",
  "items": [
    { "id": "a", "text": "milk",  "qty": 2,  "createdAt": "2026-07-01T00:00:00Z", "updatedAt": "2026-07-24T11:59:00Z" },
    { "id": "b", "text": "bread", "qty": 3,  "createdAt": "2026-07-02T00:00:00Z", "updatedAt": "2026-07-24T09:00:00Z" },
    { "id": "c", "text": "eggs",  "qty": 12, "createdAt": "2026-07-24T09:30:00Z", "updatedAt": "2026-07-24T09:30:00Z" }
  ]
}
```

Reading it element by element:

| Element | Outcome |
| --- | --- |
| `a` | **rejected wholesale.** Its local `updatedAt` (11:59) is newer than the incoming 07-20, so `text` stays `"milk"`. Matching was by identity, not position — `a` arrived second. |
| `b` | **accepted and deep-merged.** Incoming `updatedAt` (09:00) beats the local 07-10, so `qty` becomes `3`; `text: "bread"` and `createdAt` are absent from the incoming element and survive from the base. |
| `c` | **appended**, at the end of the base array. |
| order | `[a, b, c]` — base order preserved, unmatched identities appended in arrival order. |

The same three payloads were run through all three clients and produced
**identical** documents (core 0.2.1 on each):

| Client | Invocation |
| --- | --- |
| ts | `reconcileIncoming(local, incoming)` |
| dart | `FfiSyncer(...).merge(localJson, incomingJson)` |
| rust | `reconcile(local, incoming, &ReconcileOptions::default())` |

### The trap: a contended timestamp one level up

Same payloads, but now the **root** carries an `updatedAt` too and the local one
is newer (`12:00` vs the incoming `10:00`):

```js
reconcileIncoming(
  { ...local,    updatedAt: '2026-07-24T12:00:00Z' },
  { ...incoming, updatedAt: '2026-07-24T10:00:00Z' },
);
```

Actual output:

```json
{
  "id": "list-1",
  "items": [
    { "id": "a", "text": "milk",  "qty": 2, "createdAt": "2026-07-01T00:00:00Z", "updatedAt": "2026-07-24T11:59:00Z" },
    { "id": "b", "text": "bread", "qty": 1, "createdAt": "2026-07-02T00:00:00Z", "updatedAt": "2026-07-10T00:00:00Z" }
  ],
  "updatedAt": "2026-07-24T12:00:00Z"
}
```

**Nothing was applied.** `b`'s fresh update and the brand-new `c` are both gone,
because timestamp resolution gated the root node and the root rejected the entire
incoming document. That is the documented behaviour — see
[Resolution is per node, all-or-nothing](../../syncer.c/docs/MERGE_SEMANTICS.md#resolution-is-per-node-all-or-nothing)
— and it is the single most important thing to understand before designing a
schema.

## The `createdAt` / `updatedAt` / `syncedAt` convention

This is the API the project is built around, and it applies **at every level**,
including objects nested inside arrays:

| Key | Role | Effect when both sides carry it |
| --- | --- | --- |
| `updatedAt` | LWW | if the base's is newer, the incoming node is rejected |
| `syncedAt` | LWW | same guard, for a server-stamped sync time |
| `createdAt` | FWW | if the *incoming* is newer, the incoming node is rejected — protects an original creation record from a later claim |

So a record inside a jsonb array should look like:

```jsonc
{ "id": "a", "createdAt": "...", "updatedAt": "...", /* fields */ }
```

`id` gives it identity for `MERGE_BY_KEY`; `updatedAt` gives it its own LWW guard
so it is resolved independently of its siblings; `createdAt` keeps its birth
record. In the worked example above, this is precisely why `a` could be rejected
while `b` was accepted in the same merge.

Three consequences:

* **A guard only applies when both sides carry the key.** An element with no
  `updatedAt` on either side is a plain last-writer-wins deep merge, so arrival
  order decides.
* **`createdAt` FWW rejects a *newer* incoming value, and accepts an older one.**
  Verified: base `createdAt: 2026-01-01`, incoming `createdAt: 2025-06-01` — the
  incoming node wins, `owner` becomes the incoming value and `createdAt` becomes
  `2025-06-01`. FWW means "earliest sticks", not "the base always sticks".
* **Use one format consistently per key.** ISO-8601 and epoch numbers mixed
  across replicas compare lexicographically and are not chronologically
  meaningful. All three clients' test suites use ISO-8601 or plain integers,
  never both for one key.

## Practical schema guidance

Timestamp resolution is **per node and all-or-nothing**. Design around that:

1. **Give independently-editable records their own identity.** An `id` on every
   object in an array is what makes `MERGE_BY_KEY` work; without it, elements fall
   back to `UNION` semantics (still idempotent, but no per-element merging).
2. **Give independently-editable records their own timestamps.** A record without
   its own `updatedAt` is gated by whatever ancestor node has one — meaning an
   unrelated edit elsewhere can reject it.
3. **Do not put an `updatedAt` on a container whose children are edited
   independently.** That is the trap above: a root `updatedAt` turns a
   fine-grained array merge into a whole-document accept-or-reject.
4. **One identity value per array, at most once.** Duplicates bind to the first
   match and make results unstable under repeated application — which breaks
   replay idempotency.
5. **Concurrent writes converge in any order only when they do not contend for
   the same node's timestamp.** Mutations touching distinct keyed elements are
   order-independent; two mutations gated by the same node's `updatedAt` are not.

The convergence rules behind (5) are stated in
[MERGE_SEMANTICS.md](../../syncer.c/docs/MERGE_SEMANTICS.md#resolution-is-per-node-all-or-nothing);
they are exercised deliberately in the cross-client convergence scenario
(scenario 7) in [`opto-sync-e2e/test/clients/`](../../opto-sync-e2e/test/clients/),
where flush order and timestamp order are made to disagree on purpose.

## Sub-millisecond timestamps must be digit strings

```jsonc
{ "updatedAt": "1689940800123456789" }   // exact everywhere
{ "updatedAt": 1689940800123456789 }     // rounded by any JS runtime
```

The core compares **pure-digit strings numerically**, not lexicographically, so
`"10"` correctly outranks `"9"` and LWW/FWW resolution stays correct.

The problem is the host runtime, not the engine. Integers past 2^53 cannot survive
an IEEE-754 double, so any JavaScript layer — `JSON.parse` in a browser, an
Express body parser, even a test harness — silently rounds them. Demonstrated by
running both forms through the client:

```js
// digit strings: base (…789) is newer, incoming (…788) is rejected
reconcileIncoming({ doc: { updatedAt: '1689940800123456789', val: 'base'  } },
                  { doc: { updatedAt: '1689940800123456788', val: 'stale' } });
// => { doc: { updatedAt: "1689940800123456789", val: "base" } }        correct

// JSON numbers: both round to …800, so neither is strictly newer
reconcileIncoming({ doc: { updatedAt: 1689940800123456789, val: 'base'  } },
                  { doc: { updatedAt: 1689940800123456788, val: 'stale' } });
// => { doc: { updatedAt: 1689940800123456800, val: "stale" } }         WRONG
```

The stale write won, and the timestamp itself was corrupted — before the engine
ever saw it.

Rust and Dart preserve 64-bit integers exactly, so the hazard only exists where a
JS layer sits in the path. Millisecond timestamps (13 digits) and ISO-8601 strings
are unaffected; the issue starts at microsecond precision. The corpus case
*"digit-string nanosecond timestamps compare by magnitude"* in
`clients/ts/test/helpers/corpus.mjs` pins the correct behaviour on both engines.

## How merge failure surfaces

A failed merge — practically always invalid JSON on one side — is **never** an
empty string and never a silently empty document. The core returns `NULL` and each
binding turns that into its language's failure channel.

| Client | Failure | Message / value |
| --- | --- | --- |
| ts | `throw new Error(...)` | `opto-sync: CRDT merge failed (payload was not valid JSON)` |
| dart | `throw SyncerMergeException` | `native merge failed (invalid JSON input?): base=… incoming=…` |
| rust | `Err(ReconcileError::InvalidJson)` | `Display`: `input is not valid JSON` |

Two adjacent failure modes in TypeScript:

* **No engine installed** (a browser bundle that forgot `await initOptoSync()`) —
  `getMergeEngine()` throws with an explanatory message. See
  [BROWSER.md](BROWSER.md).
* **Unserializable payload** — `JSON.stringify` throws a `TypeError` before the
  engine is reached (circular references, `BigInt` values). Asserted on both
  tiers by `engine-parity.test.mjs` under *"unparseable payloads fail the same way
  on both tiers"*.

The Dart client states the rule for third-party engines explicitly on the
`ISyncer` interface: *implementations must NOT signal failure by returning `''`
or another sentinel — they should throw.* Its test *"merge failure surfaces as
`SyncerMergeException`, not empty string"* pins it. Rust's
`tests::invalid_json_errors` pins the equivalent on both argument positions.

## Reference

| | ts | dart | rust |
| --- | --- | --- | --- |
| Pure merge | `reconcileIncoming(local, incoming, opts?)` | `FfiSyncer.merge(baseJson, incomingJson)` | `reconcile(base, incoming, &opts)` |
| Via client | `client.reconcileIncoming(table, recordId, incoming, local, opts?)` | `await client.reconcileIncoming(table, recordId, incoming, local)` | `client.reconcile_incoming(local, incoming)` |
| Types | `JsonRecord` in / out | `Map<String, dynamic>` in / out | `&str` in, `String` out |
| Options type | `ReconcileOptions` | `FfiSyncer` constructor args | `ReconcileOptions` |
| Core version | `engineVersion()` | `FfiSyncer.nativeVersion` | `core_version()` |
| Strategy enum | `ArrayStrategy` (`REPLACE` 0 … `MERGE_BY_KEY` 4) | `ArrayMergeStrategy` | `ArrayStrategy` |

Note the argument-order difference: the client-level `reconcileIncoming` takes
**incoming before local**, while the pure `reconcileIncoming`/`reconcile` takes
**base (local) before incoming**. In the TS client, `tableName` and `recordId` are
accepted but unused by the merge — they exist for symmetry with `queueMutation`.

Other array strategies remain reachable through the options: `REPLACE` (0),
`APPEND` (1), `UNION` (2), `MERGE_BY_INDEX` (3). `APPEND` is the only
non-idempotent one, by design.
