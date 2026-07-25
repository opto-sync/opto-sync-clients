# Running `@opto-sync/client` in a browser

Applies to the TypeScript client only. The Dart and Rust clients target device
and server runtimes.

## Why a browser needs the WebAssembly engine

The merge semantics live in one C core. Two bindings reach it, and only one can
exist in a browser:

| Engine | Package | Load | Where |
| --- | --- | --- | --- |
| native | `@opto-sync/syncer` | N-API addon, synchronous at `require()` | Node only |
| wasm | `@opto-sync/syncer-wasm` | `WebAssembly.instantiate`, asynchronous | browser, worker, Node |

The native engine is a `.node` binary. No bundler can do anything useful with
one, and a browser cannot load it at all — so the Node entry point
([`clients/ts/src/reconcile.ts`](../clients/ts/src/reconcile.ts)), which imports
it at module scope, must never be reachable from a browser build.

The engine is therefore a *registry*, not an import
([`clients/ts/src/engine.ts`](../clients/ts/src/engine.ts)): both bindings are
reduced to a two-method `MergeEngine` interface (`mergeJson`, `version`) and one
is installed by whichever entry point ran. The reconcile logic in
[`clients/ts/src/reconcile-core.ts`](../clients/ts/src/reconcile-core.ts) imports
no engine at all and resolves it at call time, which is what lets the identical
code run on both tiers with no behavioural fork.

`getMergeEngine()` **throws** when nothing is installed rather than degrading:

```
opto-sync: no merge engine installed. In a browser, `await initOptoSync()` (from
"@opto-sync/client/browser") before reconciling; in Node, import
"@opto-sync/client", which installs the native engine for you.
```

There is no fallback engine, because a merge that quietly does nothing loses
writes.

## The initialization model

wasm instantiation is unavoidably asynchronous. That asynchrony is paid **once**,
up front, and `reconcileIncoming()` stays synchronous everywhere:

```ts
import { initOptoSync, OptoSyncClient } from '@opto-sync/client';

await initOptoSync();                  // once, at app startup
const client = new OptoSyncClient();   // Dexie over the browser's IndexedDB
client.reconcileIncoming(table, id, incoming, local);   // synchronous, like Node
```

or, without a separate startup step:

```ts
import { createOptoSyncClient } from '@opto-sync/client';

const client = await createOptoSyncClient({ databaseName: 'my-app' });
```

### Why not an async `reconcileIncoming()`

The rationale is recorded in the source
([`clients/ts/src/browser.ts`](../clients/ts/src/browser.ts) header) and in
`clients/ts/README.md`:

* reconcile is called **once per incoming record**, so an `await` lands in the hot
  path of a sync batch;
* callers frequently reconcile **inside a Dexie transaction**, and an unnecessary
  `await` there risks losing atomicity — an IndexedDB transaction auto-commits
  when its microtask queue drains;
* it would fork the API by platform (sync in Node, async in the browser), so no
  reconcile code could be shared.

### `initOptoSync()` contract

| Property | Behaviour | Verified by |
| --- | --- | --- |
| idempotent | repeated and concurrent calls share one instantiation | `browser-fallback.test.mjs`, `browser-e2e.test.mjs` (`Promise.all([init, init])`) |
| failure not cached | `initPromise` is reset on rejection, so it can be retried | `browser.ts` |
| loud when skipped | `reconcileIncoming()` throws `/no merge engine installed/` | both tests above |
| reports the tier | `isOptoSyncReady()`, `mergeEngineKind()` -> `'wasm'` | both tests above |

`InitOptoSyncOptions` accepts `wasmBinary` and `locateFile`. Neither is normally
needed: the default engine build **inlines** the wasm module, so there is no
asset to copy or serve.

## How bundlers select the engine

Purely through `exports` conditions in
[`clients/ts/package.json`](../clients/ts/package.json) — nothing to configure.

| Specifier | Condition | Resolves to | Engine |
| --- | --- | --- | --- |
| `@opto-sync/client` | `browser` + `import` | `dist/esm/browser.js` | wasm |
| `@opto-sync/client` | `browser` + `require` | `dist/browser.js` | wasm |
| `@opto-sync/client` | `import` | `dist/esm/index.js` | native |
| `@opto-sync/client` | `require` | `dist/index.js` | native |
| `@opto-sync/client/browser` | any | `dist/esm/browser.js` / `dist/browser.js` | wasm |
| `@opto-sync/client/reconcile` | `browser` | `dist/esm/browser.js` | wasm |
| `@opto-sync/client/reconcile` | otherwise | `dist/esm/reconcile.js` / `dist/reconcile.js` | native, no Dexie |

A legacy top-level `"browser": "dist/esm/browser.js"` field is also present for
bundlers that do not read `exports`.

### Worked bundler example (esbuild)

Verified by running it against a stock `--platform=browser` build with **no**
`external`, no plugins, no polyfills and no loader rules:

```js
// app/index.js
import { initOptoSync, createOptoSyncClient, reconcileIncoming, mergeEngineKind }
  from '@opto-sync/client';
await initOptoSync();
window.demo = { createOptoSyncClient, reconcileIncoming, mergeEngineKind };
```

```sh
esbuild index.js --bundle --platform=browser --format=esm --target=es2022 \
  --outfile=out.js --metafile=meta.json --minify
```

Result — 10 input modules; the `browser` condition picked `dist/esm/browser.js`
and the native binding is absent from the graph:

```
client dist files:  dist/esm/{engine,reconcile-core,client,browser}.js
wasm binding:       syncer.c/bindings/wasm/{index.mjs,lib/wrap.mjs,dist/syncer-core.single.mjs}
native binding:     []            <- bindings/typescript never enters the graph
out.js:             332.0 kB minified, 98.7 KB gzipped
```

Vite, Webpack 5 and Rollup select the same file through the same `browser`
condition; the esbuild command above is the one this repository actually
exercises (`clients/ts/test/helpers/bundle.mjs`), so treat the others as
expected-but-untested here.

## Web workers

[`clients/ts/test/browser-e2e.test.mjs`](../clients/ts/test/browser-e2e.test.mjs)
contains a test named *"the same bundle works inside a real web worker (no DOM
available)"*. It builds a worker from a blob URL, `importScripts()`es the very
same IIFE bundle the page test uses, and inside the worker calls
`initOptoSync()` followed by `reconcileIncoming()`.

What it proves:

* the bundle initialises with **no `window`** — the test asserts
  `typeof window === 'undefined'` inside the worker, so this is a genuinely
  different emscripten environment branch (`WorkerGlobalScope`), not the page
  path in disguise;
* `mergeEngineKind()` is still `'wasm'` and the core version is still reported;
* merge semantics are unchanged off the main thread — a stale incoming write
  (`updatedAt` 1000 against a local 2000) loses inside the worker exactly as it
  does on the page.

This matters because merging large documents on the main thread is what causes
jank, so the worker is the path a real app will use.

```js
// worker.js
importScripts('/opto-sync.browser.js');
self.onmessage = async () => {
  await OptoSync.initOptoSync();
  self.postMessage(OptoSync.reconcileIncoming(localPayload, incomingPayload));
};
```

## Bundle size and the absence of Node builtins

[`clients/ts/test/bundle.test.mjs`](../clients/ts/test/bundle.test.mjs) measures
what actually ships. Latest run of `npm test`:

```
browser bundle: 512.8 KB raw, 332.4 KB minified, 99.2 KB min+gzip
```

That is Dexie, the client, **and** the entire CRDT engine with the wasm module
inlined. The asserted budget is 150 KB min+gzip, so an accidental dependency or a
switch to a debug wasm build fails the test instead of shipping.

The same file asserts the graph is browser-clean. esbuild would have failed
outright on `import 'node:fs'`, but a stray `require`/`process`/`Buffer`
reference bundles fine and only explodes at runtime — which is exactly the
failure mode this package used to have. So the output is scanned for:

`require(` of a bare package · `"node:*"` specifiers · `createRequire` ·
`__dirname` · `__filename` · `Buffer.from`/`Buffer.alloc`/`new Buffer` ·
`process.binding`/`process.dlopen`/`process.version` · any `.node` path

It also asserts, from the esbuild metafile, that **no** input path contains
`bindings/typescript` and that one input path does contain `bindings/wasm`.

## Native and wasm are verified byte-identical

A divergence between engines would not be a test problem, it would be data
corruption: the browser and the server would converge on different states for the
same pair of payloads. So
[`clients/ts/test/engine-parity.test.mjs`](../clients/ts/test/engine-parity.test.mjs)
compares **serialized** output — not `deepStrictEqual` of parsed objects, which
would hide key-order, number-formatting (`1e-7` vs `0.0000001`) and int64
precision differences.

| Assertion | Scope |
| --- | --- |
| identical core version from both engines | — |
| identical `ArrayStrategy` map across both engines **and** the client's own copy | 5 values |
| `mergeJson` byte-identical | 34-case shared corpus (`test/helpers/corpus.mjs`) |
| byte-identical on **repeated** application | same 34 cases (idempotence agrees) |
| byte-identical on a **randomized** corpus | 1000 documents, fixed-seed PRNG so failures reproduce; randomized strategy, timestamp flags, key lists and `maxDepth` |
| `reconcileIncoming` byte-identical through the real client code path | 13 scenarios |
| the two tiers really are different implementations | `mergeEngineKind()` is `'native'` vs `'wasm'` — guards against parity passing vacuously |
| unparseable payloads fail the same way | circular object and `BigInt` both throw `TypeError` on both tiers |
| the wasm heap does not leak | `heapAllocatedBytes()` unchanged across 100 × 13 reconciles |

The corpus deliberately includes unicode and astral-plane strings, dotted and
escaped keys, `lwwKeys: ''` versus absent `lwwKeys` (different requests, not the
same), negative timestamps, digit-string nanosecond timestamps, integers past
2^53, and invalid JSON on either side.

`engine-parity.test.mjs` also re-asserts that `DEFAULT_RECONCILE_OPTIONS` is
identical on both tiers, and spot-checks that both engines are *right* rather
than merely in agreement (stale write loses, local-only array element survives,
`createdAt` FWW rejects a later claim).

## Real IndexedDB in headless Chromium

[`clients/ts/test/browser-e2e.test.mjs`](../clients/ts/test/browser-e2e.test.mjs)
is the only test that checks this package's actual claim — optimistic writes to
IndexedDB in a browser. No `fake-indexeddb`, no jsdom, no shims. The bundle is
served over `http://127.0.0.1:<ephemeral>` rather than `file://`, because
Chromium gives `file://` pages an opaque origin and an opaque origin has no
IndexedDB.

Flow exercised in-page (latest run: **Chromium 151.0.7922.34**):

1. **Environment sanity first**, or the rest proves nothing: real HTTP origin,
   `Object.prototype.toString.call(indexedDB) === '[object IDBFactory]'`,
   `WebAssembly` present, and `require`/`process` both **undefined**.
2. `isOptoSyncReady()` is `false`, and `reconcileIncoming()` before init throws
   `/no merge engine installed/`.
3. `await initOptoSync()`, then `Promise.all([initOptoSync(), initOptoSync()])` —
   idempotence in the browser. `mergeEngineKind()` is `'wasm'`.
4. `DEFAULT_RECONCILE_OPTIONS` is asserted equal to the cross-tier policy.
5. Two mutations are queued through `createOptoSyncClient()`; one is marked
   `SYNCED` and must leave the pending set.
6. **Proof it is the browser's own store, not an in-memory Dexie fallback:** the
   connection is closed, `indexedDB.databases()` is enumerated and must list
   `opto-browser-e2e`, then a brand-new `OptoSyncClient` reopens it (a reload) and
   the surviving pending mutation and its `jsonPayload` are checked.
7. The rows are read back through the **bare IndexedDB API** —
   `indexedDB.open` -> `transaction('localMutations','readonly')` ->
   `getAll()` — and `tableName` / `syncStatus` verified on the raw record.
8. All 13 reconcile scenarios are executed by wasm **in the page** and compared
   against native-in-Node results computed in the test process; any divergence is
   reported per scenario.
9. A full optimistic round trip: a local edit (`updatedAt` 5000) versus a stale
   server echo (`updatedAt` 10) — the local title survives and a local-only array
   element survives an empty incoming array.
10. The page is asserted to have logged **zero** console errors or page errors.

The database is deleted at the end, and the test **skips with a message** (never
silently passes) if Chromium cannot be launched. A third test prints whether a
real browser was exercised, so a skip is visible in the output rather than
mistaken for coverage.

### CI fallback

[`clients/ts/test/browser-fallback.test.mjs`](../clients/ts/test/browser-fallback.test.mjs)
covers environments that cannot download a browser. It runs the genuine ESM
browser entry and the genuine wasm engine; only the DOM (jsdom) and the storage
(`fake-indexeddb`) are fakes. The jsdom `window` matters more than it looks: the
emscripten glue picks its environment branch off `globalThis.window`, so this
still takes the `ENVIRONMENT_IS_WEB` path. It also has to copy the IndexedDB
globals onto the jsdom `window`, because Dexie resolves them off `self`/`window`
rather than off `globalThis`.
