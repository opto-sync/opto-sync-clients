# opto-sync-clients

[![CI](https://github.com/opto-sync/opto-sync-clients/actions/workflows/ci.yml/badge.svg)](https://github.com/opto-sync/opto-sync-clients/actions/workflows/ci.yml)
[![Zed package](https://github.com/opto-sync/opto-sync-clients/actions/workflows/zed-package.yml/badge.svg)](https://github.com/opto-sync/opto-sync-clients/actions/workflows/zed-package.yml)

Client libraries for **opto-sync**: optimistic local-first writes (IndexedDB in the
browser, SQLite on device) with managed sync between frontend, backend, and Supabase.

External projects import **this** repo. Each client wraps the shared C merge engine
in [`../syncer.c`](../syncer.c) through its language binding — the clients do not
reimplement reconciliation logic.

## Layout

```
opto-sync-clients/
  clients/
    dart/   package opto_sync_client — Drift/SQLite or IndexedDB queue + FFI/WASM
    ts/     package @opto-sync/client — Dexie/IndexedDB mutation queue + native syncer
    rust/   crate opto-sync-client — first-party SQLite protocol store + pluggable seams
    gleam/  package opto_sync_client — protocol queue + BEAM NIF reconciliation
```

## Optimistic writes

`syncer.c` answers "what is the merge of these two documents?" — nothing more.
The queue, the clock, the identity, and the rebase live here. The one rule that
matters:

> **Render `localView`, not `reconcileIncoming`.**

`reconcileIncoming` knows nothing about mutations still waiting to be pushed, so
rendering it directly makes a queued edit disappear whenever the server's
timestamp is newer — and reappear when the push lands. `localView` replays
un-confirmed writes on top of server state so that window never exists.

See **[docs/OPTIMISTIC_WRITES.md](docs/OPTIMISTIC_WRITES.md)** for the full
contract: rebase, `(clientId, mutationId)` dedupe, ordering, and what a push
loop still has to do.

## Reconciliation model

All clients delegate merging to `syncer_merge_json_ex` in the C core:

- **Record-level**: rows with the same primary key / unique index are deep-merged.
- **jsonb columns**: nested objects merge key-by-key; conflicts resolve by
  timestamp when enabled.
- **Timestamps**: `updatedAt` / `syncedAt` are Last-Write-Wins keys. FWW is
  unset by default because it vetoes a whole node; callers may opt in via
  `fwwKeys`.
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

## Documentation

- [Getting started](docs/GETTING_STARTED.md) — install and a minimal example per client
- [Browser](docs/BROWSER.md) — the WebAssembly engine, bundlers, workers
- [Offline queue](docs/OFFLINE_QUEUE.md) — the queue model and durability guarantees
- [Sync protocol v1](docs/SYNC_PROTOCOL_V1.md) — push dedupe, pull checkpoints, tombstones, rejection, and reset
- [Reconciliation](docs/RECONCILIATION.md) — policy, schema guidance, timestamp conventions
- [Zed package](docs/ZED_PACKAGE.md) — source-package boundary, target promotion criteria, and reproducible CI
- [Merge semantics](../syncer.c/docs/MERGE_SEMANTICS.md) — the underlying contract
- [Troubleshooting](../syncer.c/docs/TROUBLESHOOTING.md) — real failure modes

## Building

The C core builds automatically with each binding (static compile for TS/Rust,
shared library for Dart FFI):

```sh
# core (shared lib for dart FFI)
cd ../syncer.c/core && mkdir -p build && cd build && cmake .. && make syncer

# per-client
cd clients/ts   && npm ci && npm test
cd clients/dart && dart pub get && dart test
cd clients/rust && cargo test
cd clients/gleam && gleam deps download && gleam test
```

## Zed package

The repository root contains `.zpkg.toml` and `.zpkg.lock` for
`opto-sync/opto-sync-clients@0.2.0`, with a declared dependency on
`opto-sync/syncer@^0.2.1`. It remains one coordinated source package while the
native client manifests reference the sibling `syncer.c` checkout. CI rejects
isolated language targets until their installed artifacts are self-contained or
resolve the engine through a relocatable package dependency.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs all four client
suites on `ubuntu-latest` for every push to `main`, every pull request, and on
demand. Dart's leg covers both native SQLite/FFI and real Chromium
IndexedDB/WASM. Rust runs its first-party SQLite transaction/restart suite and
also builds without the default `sqlite` feature. Gleam's leg compiles and
invokes the real Rustler/C NIF.

Because the clients path-depend on `../syncer.c`, ordinary CI checks out an
immutable, certified engine commit as a sibling. Manual dispatch can override
that ref for deliberate forward-compatibility testing. Checkouts do not persist
credentials, Node installs use committed lockfiles through `npm ci`, and a
separate packaging job guards the whole-repository Zed boundary against broken
language fan-out.
