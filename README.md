# opto-sync-clients

[![CI](https://github.com/opto-sync/opto-sync-clients/actions/workflows/ci.yml/badge.svg)](https://github.com/opto-sync/opto-sync-clients/actions/workflows/ci.yml)
[![Background reactive sync](https://github.com/opto-sync/opto-sync-clients/actions/workflows/background-reactive-sync.yml/badge.svg)](https://github.com/opto-sync/opto-sync-clients/actions/workflows/background-reactive-sync.yml)
[![Zed package](https://github.com/opto-sync/opto-sync-clients/actions/workflows/zed-package.yml/badge.svg)](https://github.com/opto-sync/opto-sync-clients/actions/workflows/zed-package.yml)

Client libraries for **opto-sync**: optimistic local-first writes (IndexedDB in the
browser, SQLite on device) with managed sync between frontend, backend, and Supabase.

External projects import **this** repository. Each client wraps the shared C merge
engine in the root [`syncer.c`](syncer.c) git submodule through its language binding;
the clients do not reimplement reconciliation logic. The mode-`160000` gitlink pins
one exact core revision, so a client commit, local checkout, CI run, and Zed artifact
all use the same merge engine instead of whichever `syncer.c/main` happens to be
current.

`nix develop` provides the Rust, Node, Java, and native dependencies used by
the formal workflow. Quint/TLC plus implementation-trace replay prove the
protocol lifecycle. A second finite Quint model exhaustively checks the mobile
and desktop runner lifecycle, with the transition function executed directly
by TypeScript, Dart, and Rust; Kani proves Rust queue arithmetic, while the pinned
`syncer.c` submodule owns CBMC and Rust-FFI proofs for reconciliation.

## Layout

```text
opto-sync-clients/
  syncer.c/         pinned opto-sync/syncer.c submodule
  clients/
    dart/           package opto_sync_client — Drift/SQLite or IndexedDB queue + FFI/WASM
    ts/             package @opto-sync/client — Dexie/IndexedDB mutation queue + native syncer
    rust/           crate opto-sync-client — first-party SQLite protocol store + pluggable seams
    gleam/          package opto_sync_client — protocol queue + BEAM NIF reconciliation
    php/            package opto-sync/opto-sync-client — transport-neutral PHP protocol queue
    dotnet/         C# binding + idiomatic F# facade for SAFE Stack and managed apps
    reactive-ts/    package @opto-sync/reactive — RxJS, Service Worker, HTTP/WS/TCP/Supabase hints
    reactive-dart/  package opto_sync_reactive — RxDart + Flutter/iOS/Android background adapters
```

## Optimistic writes

`syncer.c` answers “what is the merge of these two documents?”—nothing more.
The queue, the clock, the identity, and the rebase live here. The one rule that
matters:

> **Render `localView`, not `reconcileIncoming`.**

`reconcileIncoming` knows nothing about mutations still waiting to be pushed, so
rendering it directly makes a queued edit disappear whenever the server's
timestamp is newer—and reappear when the push lands. `localView` replays
unconfirmed writes on top of server state so that window never exists.

See **[docs/OPTIMISTIC_WRITES.md](docs/OPTIMISTIC_WRITES.md)** for the full
contract: rebase, `(clientId, mutationId)` dedupe, ordering, and what a push
loop still has to do.

The reactive packages make the write strategy explicit per operation:

- **remote-confirmed** — send and wait before changing local authoritative state;
- **local-durable** — atomically save locally and queue, then let background sync land it;
- **local-then-remote** — render immediately but await one protocol cycle before completion.

WebSocket, Supabase Realtime, BroadcastChannel, and TCP events are wake hints.
HTTP protocol push/pull remains the commit-ordered source of truth.

## Reconciliation model

All clients delegate merging to `syncer_merge_json_ex` in the pinned C core:

- **Record-level:** rows with the same primary key or unique index are deep-merged.
- **jsonb columns:** nested objects merge key-by-key; conflicts resolve by
  timestamp when enabled.
- **Timestamps:** `updatedAt` and `syncedAt` are Last-Write-Wins keys. FWW is
  unset by default because it vetoes a whole node; callers may opt in through
  `fwwKeys`.
- **Objects in arrays** (`arrayStrategy: mergeByKey`): array elements are matched
  by identity keys (`arrayMatchKeys`, default `"id"`). Matched pairs deep-merge
  with per-element timestamp resolution, new elements append, unmatched existing
  elements are kept, and scalars behave like a union so replay is idempotent.

Other array strategies are `replace` (default), `append`, `union`, and
`mergeByIndex`.

## Timestamp representation

Represent high-precision timestamps as **digit strings**, not JSON numbers:

```jsonc
{ "updatedAt": "1689940800123456789" }   // exact everywhere
{ "updatedAt": 1689940800123456789 }     // rounded by JavaScript hosts
```

The C core compares pure-digit strings numerically, so `"10"` correctly outranks
`"9"`. The caveat is the host runtime: JavaScript cannot preserve integers past
2^53, while Rust and Dart preserve 64-bit integers exactly. Millisecond
timestamps and ISO-8601 strings are unaffected. The cross-server suites in
[`opto-sync-e2e`](../opto-sync-e2e) verify the behavior per runtime.

## Documentation

- [Getting started](docs/GETTING_STARTED.md)—install and a minimal example per client
- [Browser](docs/BROWSER.md)—the WebAssembly engine, bundlers, and workers
- [Background and reactive sync](docs/BACKGROUND_REACTIVE_SYNC.md)—RxJS/RxDart, optimism, Service Workers, mobile workers, sessions, and transports
- [Offline queue](docs/OFFLINE_QUEUE.md)—the queue model and durability guarantees
- [Sync protocol v1](docs/SYNC_PROTOCOL_V1.md)—push dedupe, pull checkpoints, tombstones, rejection, and reset
- [SDK capability and portable API contract](docs/SDK_API_CONTRACT.md)—six proven JSON Schema-governed Rust/Dart/TypeScript operations, explicit candidate differences, and injected ORE logging
- [Reconciliation](docs/RECONCILIATION.md)—policy, schema guidance, and timestamp conventions
- [Observability](docs/OBSERVABILITY.md)—privacy-bounded ORE/OpenTelemetry records shared by Rust, Dart, and TypeScript
- [Zed package](docs/ZED_PACKAGE.md)—package boundary, reproducibility, and release procedure
- [Merge semantics](syncer.c/docs/MERGE_SEMANTICS.md)—the underlying native contract
- [Troubleshooting](syncer.c/docs/TROUBLESHOOTING.md)—real failure modes
- [Security policy](SECURITY.md)—private reporting and supported-version posture

## Clone and build

Initialize the pinned core when cloning:

```sh
git clone --recurse-submodules https://github.com/opto-sync/opto-sync-clients.git
cd opto-sync-clients
git submodule status --cached syncer.c
python3 scripts/check-dependency-boundary.py
```

The core builds automatically with the static TypeScript and Rust bindings. Dart
FFI needs a shared library:

```sh
# shared core for Dart FFI
cmake -S syncer.c/core -B syncer.c/core/build
cmake --build syncer.c/core/build --target syncer

# per-client frozen/native suites
(cd syncer.c/bindings/typescript && npm ci)
(cd clients/ts && npm ci && npm test)
(cd clients/dart && dart pub get && dart analyze && dart test)
(cd clients/rust && cargo test --locked --all-targets)
(cd clients/gleam && gleam deps download && gleam test)
OPTO_SYNC_NATIVE_LIBRARY="$PWD/syncer.c/core/build/libsyncer.so" \
  dotnet run --project clients/dotnet/tests/OptoSync.Client.Contract --configuration Release
OPTO_SYNC_NATIVE_LIBRARY="$PWD/syncer.c/core/build/libsyncer.so" \
  dotnet run --project clients/dotnet/tests/OptoSync.FSharp.Contract --configuration Release

# reactive/background suites
(cd clients/reactive-ts && npm ci && npm test)
(cd clients/reactive-dart && dart pub get && dart analyze && \
  dart run tool/lifecycle_formal_self_test.dart && dart run tool/self_test.dart)
python3 clients/reactive-dart/tool/check_native_background_adapters.py
```

## Zed package

The repository root declares `opto-sync/opto-sync-clients@0.4.0` in
`.zpkg.toml`, with `.zpkg.lock` committed for frozen source workflows. The first
release is intentionally one whole-repository package: a language-only target
would omit the root native submodule required by that client. The package
workflow initializes the gitlink, validates every dependency path, builds pinned
Zed tooling, packs twice, requires byte-identical archives, audits the file
boundary, and runs `zed publish --dry-run`.

```sh
zed pack
zed publish --dry-run
```

See [docs/ZED_PACKAGE.md](docs/ZED_PACKAGE.md) before adding language-specific
Zed targets or changing the pinned core.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs all four core client
suites on `ubuntu-latest` for every push to `main`, every pull request, and on
demand. Checkout is recursive; there is no mutable sibling `syncer.c@main`
checkout. Dart covers native SQLite/FFI and real Chromium IndexedDB/WASM. Rust
runs its SQLite transaction/restart suite and builds without the default
`sqlite` feature. Gleam compiles and invokes the real Rustler/C NIF.

[`.github/workflows/background-reactive-sync.yml`](.github/workflows/background-reactive-sync.yml)
adds RxJS type/unit tests, a real two-tab Service Worker + IndexedDB test, RxDart
behavioral tests, mobile adapter contract checks, 750 randomized Rust-wrapper vs
raw-C ABI comparisons, and the Postgres/Supabase integration profiles using the
current client branch.

[`.github/workflows/mobile-native-build.yml`](.github/workflows/mobile-native-build.yml)
compiles the mobile background-sync native sources rather than only inspecting
them: the Kotlin plugin, the Kotlin worker, and the plain-Java worker go through
Gradle on `ubuntu-latest`, and the Swift plugin plus its Objective-C bridge go
through Xcode on `macos-15`, with the reference adapters in
`clients/reactive-dart/native` compiled alongside. Both jobs build a throwaway
Flutter host app that depends on the plugin by path, so no device, emulator,
simulator, or signing identity is involved. Reproduce either leg locally with
`python3 scripts/build-mobile-native.py android` or `... ios`.
