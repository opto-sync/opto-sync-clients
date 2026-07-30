# Getting started

Adoption guide for the four opto-sync **client** libraries — the packages an
external project imports.

| Client | Package / crate | Local store | Merge engine |
| --- | --- | --- | --- |
| TypeScript | `@opto-sync/client` (`clients/ts`) | Dexie / IndexedDB | native N-API addon in Node, WebAssembly in the browser |
| Dart | `opto_sync_client` (`clients/dart`) | Drift / SQLite natively; Drift SQLite persisted in IndexedDB on web | `libsyncer` over `dart:ffi`, or WebAssembly in a browser |
| Rust | `opto-sync-client` (`clients/rust`) | first-party SQLite protocol store, or your own store | statically linked C core via `syncer-rs` |
| Gleam | `opto_sync_client` (`clients/gleam`) | versioned queue snapshot in your BEAM store | Rustler NIF via the typed Gleam binding |

All four ship no concrete HTTP transport—you supply endpoints,
authentication/token refresh, and authoritative-store callbacks. TypeScript
and Dart include transport-neutral `ProtocolSyncLoop` coordinators. Rust
provides `ProtocolSyncDriver`, a runtime-neutral pull/push/pull cycle whose
queue persistence boundary is explicit. See [OFFLINE_QUEUE.md](OFFLINE_QUEUE.md)
for the contract.

## Prerequisite: `syncer.c` as a sibling checkout

Every client path-depends on the merge core in a *sibling* repository. Nothing
resolves without it:

```
<parent>/
  opto-sync-clients/     # this repo
  syncer.c/              # opto-sync/syncer.c
```

| Client | Declared dependency |
| --- | --- |
| ts | `file:../../../syncer.c/bindings/wasm` (required), `file:../../../syncer.c/bindings/typescript` (optional) |
| dart | `path: ../../../syncer.c/bindings/dart` |
| rust | `path = "../../../syncer.c/bindings/rust"` |
| gleam | `{ path = "../../../syncer.c/bindings/gleam" }` |

Core version at the time of writing: **0.2.1** (`engineVersion()` /
`syncer.nativeVersion` / `core_version()` all report it).

---

## TypeScript — `@opto-sync/client`

### Install

```sh
cd clients/ts
npm install          # runs the postinstall bootstrap, see below
npm run build        # tsc (CJS) + tsc (ESM) + scripts/postbuild.mjs
```

`npm test` runs `npm run build` first, so a plain `npm test` is enough from a
clean checkout.

### What `npm install` actually does

`package.json` splits the two engines deliberately
([`clients/ts/package.json`](../clients/ts/package.json)):

| Dependency | Section | Why |
| --- | --- | --- |
| `dexie` | `dependencies` | the IndexedDB queue |
| `@opto-sync/syncer-wasm` | `dependencies` | the browser engine; pure JS + inlined wasm, nothing to compile |
| `@opto-sync/syncer` | **`optionalDependencies`** | the Node N-API addon; needs a C toolchain |

The native addon is optional for two reasons, both documented in
[`scripts/bootstrap-native-binding.mjs`](../clients/ts/scripts/bootstrap-native-binding.mjs):

1. **It has to be, or a clean install fails.** npm installs a `file:`
   dependency as a *symlink* and does not install the linked package's own
   dependencies — so the binding's lockfile entry for `node-addon-api` does not
   exist here. npm still runs the binding's `install` script (`node-gyp
   rebuild`), which evaluates `require('node-addon-api').include` from
   `syncer.c/bindings/typescript`, whose resolution chain never includes
   `clients/ts/node_modules`. Under `dependencies` that `MODULE_NOT_FOUND` takes
   the whole install down. Under `optionalDependencies` npm tolerates the
   failure.
2. **It is the honest classification.** A browser-only consumer never loads the
   addon, so a machine with no C toolchain should still be able to install the
   package.

The `postinstall` hook then bootstraps the binding the way npm cannot:

1. exits 0 with a note if there is no sibling `syncer.c/bindings/typescript`
   (e.g. installing a published tarball);
2. runs `npm install` **inside the binding directory**, which compiles
   `syncer.node` in place — required, because the binding's `binding.gyp`
   compiles `../../core/src/syncer.c`, a path that only exists in the source
   tree (this is why `install-links=true` does not work either);
3. recreates the `node_modules/@opto-sync/syncer` symlink npm prunes when an
   optional dependency's install script fails (a directory junction on Windows);
4. `require()`s the addon and logs the core version.

It is **never fatal**. If the build fails it prints a warning and exits 0 — the
browser/wasm engine is unaffected. It is also self-healing: once the addon is
built, later `npm install` runs succeed through npm's own path and the script is
a no-op.

`scripts/postbuild.mjs` writes `dist/esm/package.json` containing
`{"type":"module","sideEffects":false}` so Node parses the ESM build as ESM
(the package itself is CommonJS).

### Minimal working example

Verified by running it. In a browser, drop the `fake-indexeddb` import and add
`await initOptoSync()` first — see [BROWSER.md](BROWSER.md).

```js
import 'fake-indexeddb/auto';                       // Node only; a browser has real IndexedDB
import { OptoSyncClient, SYNC_STATUS } from '@opto-sync/client';

const client = new OptoSyncClient({ databaseName: 'demo' });

// 1. optimistic local write -> durable queue
const mid = await client.queueMutation('todos', 'todo-1', {
  id: 'todo-1', title: 'buy milk', updatedAt: '2026-07-24T12:00:00Z',
});
const [queued] = await client.pendingMutations();
console.log(queued.tableName, queued.recordId, queued.syncStatus === SYNC_STATUS.PENDING);

// 2. ... your HTTP layer POSTs queued.jsonPayload, then:
await client.markMutation(mid, SYNC_STATUS.SYNCED);
console.log('pending after flush:', (await client.pendingMutations()).length);

// 3. reconcile a server payload against the local copy (synchronous)
const merged = client.reconcileIncoming('todos', 'todo-1',
  { id: 'todo-1', title: 'stale server copy', updatedAt: '2026-07-20T08:00:00Z' },
  { id: 'todo-1', title: 'buy milk',          updatedAt: '2026-07-24T12:00:00Z' });
console.log(merged.title);

await client.db.delete();
```

```
todos todo-1 true
pending after flush: 0
buy milk
```

`reconcileIncoming` is **pure** — it returns the merge and touches no storage.
Persisting the result is your job.

### Tests

```sh
cd clients/ts && npm test        # 76 tests, 0 failures
```

Headless-Chromium coverage skips loudly if a browser cannot be launched; install
it with `npx playwright install chromium`.

---

## Dart — `opto_sync_client`

### Install

Requires Dart SDK `^3.12.1`. The Drift queue opens SQLite through
`package:sqlite3`, which `dlopen`s the system `libsqlite3`.

```sh
# 1. build the core SHARED library (Dart FFI cannot use a static archive)
cd syncer.c/core && mkdir -p build && cd build && cmake .. && make syncer
#    -> libsyncer.dylib (macOS) / libsyncer.so (Linux) / syncer.dll (Windows)

# 2. the client
cd opto-sync-clients/clients/dart && dart pub get
```

### How the shared library is located

`FfiSyncer({String? libraryPath, ...})` uses `libraryPath` when given, otherwise
calls `resolveSyncerLibraryPath()` re-exported from the binding
([`clients/dart/lib/opto_sync_client.dart`](../clients/dart/lib/opto_sync_client.dart),
implementation in `syncer.c/bindings/dart/lib/syncer.dart`):

1. the `SYNCER_LIB_PATH` environment variable, if set and non-empty;
2. otherwise, inside `directory` (**default `'.'`** — the process cwd), the
   current platform's name first (`libsyncer.dylib` / `libsyncer.so` /
   `syncer.dll`) and then the other conventions, returning the first that exists
   on disk;
3. if none exist, the platform-preferred path is returned anyway, so
   `DynamicLibrary.open` reports the canonical missing location rather than a
   confusing one.

Because step 2 defaults to the cwd, production code should pass either
`SYNCER_LIB_PATH` or an explicit `libraryPath` /
`resolveSyncerLibraryPath(directory: ...)`.

The test suite does not rely on the cwd at all: `locateCoreLibrary()` in
[`clients/dart/test/opto_sync_client_test.dart`](../clients/dart/test/opto_sync_client_test.dart)
honours `SYNCER_LIB_PATH`, then walks up to 10 levels from both the cwd and
`Platform.script`'s directory looking for `syncer.c/core/build/<platform lib>`,
and throws a `StateError` naming both start points if it finds nothing.

### Minimal working example

Verified by running it.

```dart
import 'dart:io';
import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';

Future<void> main() async {
  final syncer = FfiSyncer(
    libraryPath: resolveSyncerLibraryPath(directory: '../../../syncer.c/core/build'),
  );
  final db = OptoSyncDatabase(NativeDatabase(File('queue.sqlite')));
  final client = OptoSyncClient(db: db, syncer: syncer);

  // 1. optimistic local write -> durable queue
  await client.queueMutation('todos', 'todo-1', {
    'id': 'todo-1', 'title': 'buy milk', 'updatedAt': '2026-07-24T12:00:00Z',
  });
  final row = (await db.select(db.localMutations).get()).first;
  print('${row.targetTable} ${row.recordId} ${row.syncStatus == SyncStatus.pending}');

  // 2. ... your HTTP layer POSTs row.jsonPayload, then:
  await (db.update(db.localMutations)..where((t) => t.id.equals(row.id)))
      .write(LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)));

  // 3. reconcile a server payload against the local copy
  final merged = await client.reconcileIncoming('todos', 'todo-1',
      {'id': 'todo-1', 'title': 'stale server copy', 'updatedAt': '2026-07-20T08:00:00Z'},
      {'id': 'todo-1', 'title': 'buy milk', 'updatedAt': '2026-07-24T12:00:00Z'});
  print(merged['title']);

  await db.close();
}
```

```
todos todo-1 true
buy milk
```

The Dart `OptoSyncClient` also exposes protocol-aware `queueDelete`,
`pendingMutations`, `protocolPushRequest`, `acknowledgePush(response, request)`,
`pullCheckpoint`, and `setPullCheckpoint`. The publicly exposed
`OptoSyncDatabase` remains available for application-specific transactions.
Use `queueMutationAtomic` / `queueDeleteAtomic` when the application row uses
that same SQLite connection, so the row and queue intent commit together.
`reconcileIncoming` is declared `Future` but does no I/O — the merge itself is a
synchronous FFI call.

### Tests

```sh
cd clients/dart && dart test        # 52 tests, All tests passed!
```

Set `SYNCER_LIB_PATH` if the core is not under a discoverable
`syncer.c/core/build`. Drift prints a "database class created multiple times"
warning during the durability test; it is expected — that test deliberately
opens the same file from three successive connections.

---

## Rust — `opto-sync-client`

### Install

Edition 2021. The sibling binding statically links the C core, so there is
nothing to `dlopen` at runtime. The default `sqlite` feature bundles SQLite
through `rusqlite`; set `default-features = false` for a core-only,
application-supplied store.

```toml
[dependencies]
opto-sync-client = { path = "../opto-sync-clients/clients/rust" }
```

### Minimal working example

Verified by running it.

```rust
use opto_sync_client::{InMemoryStore, MutationStatus, MutationStore, OptoSyncClient};

fn main() {
    let mut client = OptoSyncClient::new(InMemoryStore::new());

    // 1. optimistic local write -> queue (InMemoryStore is NOT durable)
    let id = client.queue_mutation(
        r#"{"id":"todo-1","title":"buy milk","updatedAt":"2026-07-24T12:00:00Z"}"#.to_string(),
    );
    let pending = client.store().pending();
    println!("{} {:?}", pending.len(), pending[0].status);

    // 2. ... your HTTP layer POSTs pending[0].payload, then:
    assert!(client.store_mut().mark_synced(id));
    println!("pending after flush: {}", client.store().pending().len());
    assert_eq!(client.store().all()[0].status, MutationStatus::Synced);

    // 3. reconcile a server payload against the local copy
    let merged = client
        .reconcile_incoming(
            r#"{"id":"todo-1","title":"buy milk","updatedAt":"2026-07-24T12:00:00Z"}"#,
            r#"{"id":"todo-1","title":"stale server copy","updatedAt":"2026-07-20T08:00:00Z"}"#,
        )
        .expect("merge must succeed");
    println!("{merged}");
}
```

```
1 Pending
pending after flush: 0
{"id":"todo-1","title":"buy milk","updatedAt":"2026-07-24T12:00:00Z"}
```

The reconciliation API remains string-in / string-out (`&str` -> `String`).
The public `protocol` module separately provides serde-compatible wire types and
a serializable `ProtocolQueue`. `InMemoryStore` is for tests and toy clients.

For production local-first protocol state, open the first-party SQLite store:

```rust
use opto_sync_client::sqlite::SqliteProtocolStore;

let mut store = SqliteProtocolStore::open("opto-sync.sqlite", "stable-install-id")?;
store.queue_upsert_record(
    "tasks",
    "todo-1",
    serde_json::json!({"title": "buy milk"}),
    None,
    false,
)?;
let mut queue = store.load_queue()?;
let result = driver.sync_cycle_atomic(&mut queue, &mut transport, &mut store)?;
```

`queue_upsert_with` / `queue_delete_with` let application SQL run in the same
transaction as mutation allocation. The store also commits pull pages,
snapshots, accepted/rejected overlays, and checkpoints atomically. HTTP,
executor, lifecycle scheduling, and ORM integration remain application seams.

### Tests

```sh
cd clients/rust && cargo test --offline
# 60 unit + 2 generic durability + 10 first-party SQLite integration tests
```

---

## Gleam — `opto_sync_client`

The Gleam client targets Erlang/OTP and invokes the same core through the typed
Gleam wrapper over the Rustler NIF. It owns no HTTP or database dependency.

```gleam
import gleam/option.{None}
import opto_sync_client

let assert Ok(queue) = opto_sync_client.new("stable-installation-id")
let assert Ok(#(queue, _)) =
  opto_sync_client.enqueue_upsert(
    queue,
    "todos",
    "todo-1",
    "{\"title\":\"buy milk\",\"updatedAt\":2}",
    None,
    False,
  )
let snapshot = opto_sync_client.encode_queue(queue)
// Commit `snapshot` with the optimistic row in your Ecto/SQL transaction.

let assert Ok(restored) = opto_sync_client.decode_queue(snapshot)
let assert Ok(request) = opto_sync_client.build_push_request(restored, 100)
let body = opto_sync_client.encode_push_request(request)
```

`decode_push_response` and `acknowledge` validate the exact immutable batch.
`reconcile` invokes the native NIF. The Linux container suite currently passes
13 queue/restart/wire/native cases, and the e2e suite pushes, retries, pulls,
and deletes through the live PostgreSQL protocol server.

---

## Where to go next

| Document | Topic |
| --- | --- |
| [BROWSER.md](BROWSER.md) | the WebAssembly engine, `initOptoSync()`, bundlers, web workers |
| [OFFLINE_QUEUE.md](OFFLINE_QUEUE.md) | queue model, durability, flush/replay, supplying transport |
| [RECONCILIATION.md](RECONCILIATION.md) | the default merge policy, worked examples, schema guidance |
| [`syncer.c/docs/MERGE_SEMANTICS.md`](../../syncer.c/docs/MERGE_SEMANTICS.md) | the authoritative merge contract (core v0.2.1) |
| [`opto-sync-e2e/test/clients/`](../../opto-sync-e2e/test/clients/) | client-in-the-loop e2e against a live server |
