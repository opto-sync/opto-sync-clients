# @opto-sync/client

Offline-first sync client for TypeScript/JavaScript: a Dexie-backed optimistic
mutation queue on IndexedDB, plus CRDT reconciliation by the syncer.c merge
engine.

**It now actually runs in a browser.** Until recently the reconcile path
hard-imported `@opto-sync/syncer`, a Node N-API addon — so a package whose whole
pitch is optimistic writes to IndexedDB could not be bundled for, or loaded in,
the one place IndexedDB exists. The merge engine is now selectable: native in
Node, WebAssembly in the browser, identical semantics on both.

---

## Quick start

### Browser (and any bundler)

```ts
import { initOptoSync, OptoSyncClient } from '@opto-sync/client';

await initOptoSync();                  // once, at startup — instantiates wasm
const client = new OptoSyncClient();   // Dexie over the browser's IndexedDB

// optimistic local write, survives a reload
await client.queueMutation('todos', 'todo-1', { title: 'buy milk', updatedAt: Date.now() });

// server sends its copy back; a stale echo must not clobber the local edit
const merged = client.reconcileIncoming('todos', 'todo-1', serverPayload, localPayload);
```

or, to avoid a separate startup step:

```ts
import { createOptoSyncClient } from '@opto-sync/client';

const client = await createOptoSyncClient({ databaseName: 'my-app' });
```

Bundlers resolve `@opto-sync/client` to the browser build automatically via the
`browser` condition in `exports`. Nothing to configure: no `external`, no
polyfills, no wasm asset to copy or serve (the engine's default build inlines
it).

### Node / server / tests

```ts
import { reconcileIncoming, engineVersion } from '@opto-sync/client';

engineVersion();                       // "0.2.1"
reconcileIncoming(localPayload, serverPayload);   // ready immediately, no init
```

The Node entry installs the native addon at import time, so there is **no init
step and nothing became async**. This path is byte-for-byte unchanged in
behaviour from before the restructure.

---

## Ergonomics: why `initOptoSync()` and not async reconcile

wasm instantiation is unavoidably asynchronous. The obvious alternative —
making `reconcileIncoming()` async and lazily instantiating on first use — was
rejected:

* Reconcile is called once per incoming record, so an await would land in the
  hot path of a sync batch.
* Callers frequently reconcile **inside a Dexie transaction**, and an
  unnecessary await there is a chance to lose transaction atomicity (an IndexedDB
  transaction auto-commits when its microtask queue drains).
* It would fork the API by platform: sync in Node, async in the browser, so no
  shared reconcile code.

So the asynchrony is paid exactly once, explicitly, up front — and
`reconcileIncoming()` stays synchronous and identical on every platform.

`initOptoSync()` is **idempotent and concurrency-safe**: call it from as many
entry points as you like; repeated and simultaneous calls share a single wasm
instance. A rejected init is not cached, so it can be retried.

Forgetting it does not silently misbehave. There is no fallback engine and no
degraded merge — `reconcileIncoming()` throws:

```
opto-sync: no merge engine installed. In a browser, `await initOptoSync()` ...
```

which is far better than a merge that quietly drops writes.

---

## The default merge policy is a cross-tier contract

```ts
{
  arrayStrategy:      ArrayStrategy.MERGE_BY_KEY,  // 4
  arrayMatchKeys:     'id',
  resolveByTimestamp: true,
  lwwKeys:            'updatedAt,syncedAt',
  // no fwwKeys — see below
}
```

The Dart client, the Rust client and every opto-sync server use exactly this
policy. Changing any value makes the same document reconcile differently per
platform, so it is pinned by tests on both the native and the wasm tier.

`arrayStrategy` in particular must stay explicit: the engine's own default is
REPLACE, under which an incoming array discards local elements the server never
saw *and* applies elements the timestamp guard should have rejected
(element-level resolution only happens under MERGE_BY_KEY).

### `fwwKeys` is not in the default policy

First-write-wins is a **node-level veto**, not protection of one field. If the
incoming node's FWW key is newer than the base's, the core rejects the *entire*
incoming node — however new its `updatedAt` is:

```ts
reconcileIncoming(
  { doc: { createdAt: 100, updatedAt: 100,    v: 'base' } },
  { doc: { createdAt: 200, updatedAt: 999999, v: 'NEWEST WRITE' } },
  { fwwKeys: 'createdAt' },
)
// -> { doc: { createdAt: 100, updatedAt: 100, v: 'base' } }   the write is gone
```

`createdAt` used to be in this policy. Under it, any replica that ended up
holding a later `createdAt` for a record — two devices creating the same id
offline is enough — could never write to that record again: permanently,
silently, behind a successful response. Pass `fwwKeys` explicitly when "the
first writer owns this whole node, forever" really is the semantics you want.

---

## Architecture

```
src/engine.ts          the seam: MergeEngine interface + registry + ArrayStrategy
src/reconcile-core.ts  pure reconcile logic — no engine import, no storage
src/client.ts          OptoSyncClient / Dexie queue — engine-agnostic
src/reconcile.ts       Node entry: installs the native addon, re-exports the core
src/index.ts           Node entry: reconcile + client
src/browser.ts         browser entry: initOptoSync() installs wasm, re-exports
```

`reconcileIncoming` is pure and engine-agnostic: it resolves the engine from the
registry at call time. Only the two entry points know which engine exists, and
either can be replaced with a test double via `setMergeEngine()`.

### Entry points

| Import | Engine | Init |
| --- | --- | --- |
| `@opto-sync/client` (Node) | `@opto-sync/syncer`, native N-API | none, synchronous |
| `@opto-sync/client` (browser condition) | `@opto-sync/syncer-wasm` | `await initOptoSync()` |
| `@opto-sync/client/browser` (explicit) | `@opto-sync/syncer-wasm` | `await initOptoSync()` |
| `@opto-sync/client/reconcile` | pure reconcile only, no Dexie | per platform, as above |

The package ships both CommonJS (`dist/`) and ES modules (`dist/esm/`), wired
through `exports` with `browser` / `import` / `require` conditions.

Browser bundle size, measured by `test/bundle.test.mjs`: **~99 KB minified +
gzipped**, for Dexie, the client and the entire CRDT engine with the wasm
inlined.

---

## Tests

```sh
npm install
npm run build
npm test          # 43 tests
```

| File | What it covers |
| --- | --- |
| `test/reconcile.test.js` | the original native reconcile suite, unchanged |
| `test/queue.test.js` | the original Dexie queue suite (fake-indexeddb), unchanged |
| `test/engine-parity.test.mjs` | native vs wasm: byte-identical output over a 34-case corpus, 1000 randomized documents, and all 13 reconcile scenarios |
| `test/bundle.test.mjs` | the browser entry bundles with a stock esbuild browser config; no Node builtins, no native addon, within a size budget |
| `test/browser-e2e.test.mjs` | **real headless Chromium**: real IndexedDB, real WebAssembly, plus a real web worker |
| `test/browser-fallback.test.mjs` | the browser entry under jsdom + fake-indexeddb, for CI without a browser download |

`test/browser-e2e.test.mjs` skips (loudly, never silently) if Chromium cannot be
launched; get it with `npx playwright install chromium`.

Parity is asserted on **serialized** output, not on `deepStrictEqual` of parsed
objects, so key order, number formatting and int64 precision differences cannot
hide. No native-vs-wasm divergence exists at the time of writing.

---

## Installing from a clean checkout

`npm install` used to fail outright for anyone who had not already run
`npm install` by hand inside `syncer.c/bindings/typescript`. The native binding
is a `file:` dependency, so npm symlinks it and does **not** install the linked
package's own dependencies — but npm does run its `install` script
(`node-gyp rebuild`), which then cannot resolve `node-addon-api` and takes the
whole install down with it.

Three obvious fixes do not work, each verified rather than assumed:

* adding `node-addon-api` here puts it in `clients/ts/node_modules`, which is not
  on the resolution chain walked from the binding's directory;
* a `preinstall` hook is too late — npm runs the root package's lifecycle scripts
  *after* reifying the tree, so the dependency's install script has already
  failed;
* `install-links=true` (copy instead of symlink) fixes the dependency but breaks
  the build: the binding's `binding.gyp` compiles `../../core/src/syncer.c`, a
  path that only exists in the source tree.

What this package does instead:

1. the native binding is an **`optionalDependency`**, so a failed native build
   never blocks installation — which is also the honest classification now that
   the browser/wasm engine needs no build at all;
2. `scripts/bootstrap-native-binding.mjs` runs as `postinstall` (after npm is
   done) and bootstraps the binding the way npm cannot: installs its
   dependencies and builds it **in place**, where `binding.gyp`'s relative paths
   resolve, then restores the `node_modules/@opto-sync/syncer` symlink npm
   pruned when the optional dependency failed.

It is self-healing and idempotent: once bootstrapped, later installs succeed
through npm's own path and the script is a no-op. Verified against a pristine
copy of the repositories for `npm install`, a repeat `npm install`, and a cold
`npm ci`.

If no C toolchain is available the script warns and continues: the browser/wasm
path is unaffected, and only the native Node engine is unavailable.
