# opto-sync-clients

Client libraries for **opto-sync**: optimistic local-first writes (IndexedDB in the
browser, SQLite on device) with managed sync between frontend, backend, and Supabase.

External projects import **this** repo. Each client wraps the shared C merge engine
in [`../syncer.c`](../syncer.c) through its language binding — the clients do not
reimplement reconciliation logic.

## Layout

```
opto-sync-clients/
  clients/
    dart/   package opto_sync_client — Drift/SQLite mutation queue + FFI syncer
    ts/     package @opto-sync/client — Dexie/IndexedDB mutation queue + native syncer
    rust/   crate opto-sync-client — reconcile API + pluggable mutation store
```

## Reconciliation model

All clients delegate merging to `syncer_merge_json_ex` in the C core:

- **Record-level**: rows with the same primary key / unique index are deep-merged.
- **jsonb columns**: nested objects merge key-by-key; conflicts resolve by
  timestamp when enabled.
- **Timestamps**: `updatedAt` / `syncedAt` are Last-Write-Wins keys; `createdAt`
  is First-Write-Wins. Configurable per merge via `lwwKeys` / `fwwKeys`.
- **Objects in arrays** (`arrayStrategy: mergeByKey`): array elements are matched
  by identity keys (`arrayMatchKeys`, default `"id"`). Matched pairs deep-merge
  with per-element timestamp resolution, new elements append, unmatched existing
  elements are kept. Scalars behave like a union, so re-syncing the same payload
  is idempotent.

Other array strategies: `replace` (default), `append`, `union`, `mergeByIndex`.

## Timestamp representation (important)

Represent high-precision timestamps as **digit strings**, not JSON numbers:

```jsonc
{ "updatedAt": "1689940800123456789" }   // ✅ exact everywhere
{ "updatedAt": 1689940800123456789 }     // ⚠️  rounded by any JS runtime
```

The C core compares pure-digit strings **numerically** (not lexicographically),
so `"10"` correctly outranks `"9"` and LWW/FWW resolution stays correct.

The reason for the caveat is the host runtime, not the merge engine: integers
past 2^53 cannot survive an IEEE-754 double, so any JavaScript/TypeScript layer
— `JSON.parse` in a browser, an Express body parser, even a test harness —
silently rounds `1689940800123456789` to `...800`. Rust and Dart preserve
64-bit integers exactly. This is verified per runtime by the cross-server suite
in `../opto-sync-e2e/test/cross-server/`.

Millisecond timestamps (13 digits) and ISO-8601 strings are unaffected; the
issue only arises at microsecond precision and beyond.

## Building

The C core builds automatically with each binding (static compile for TS/Rust,
shared library for Dart FFI):

```sh
# core (shared lib for dart FFI)
cd ../syncer.c/core && mkdir -p build && cd build && cmake .. && make syncer

# per-client
cd clients/ts   && npm install && npm test
cd clients/dart && dart pub get && dart test
cd clients/rust && cargo test
```
