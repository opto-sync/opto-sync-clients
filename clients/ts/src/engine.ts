/**
 * The merge engine seam.
 *
 * opto-sync's merge semantics live in a single C core (syncer.c), but that core
 * is reached differently depending on where the client runs:
 *
 *   - Node / server / test runner -> @opto-sync/syncer, an N-API addon. Loads
 *     synchronously at require() time. Cannot exist in a browser.
 *   - Browser / worker            -> @opto-sync/syncer-wasm. Must be
 *     instantiated asynchronously before first use.
 *
 * Nothing in the reconcile logic should have to know which of those it got, so
 * both are reduced to this one tiny interface and registered here. The
 * reconcile path resolves the engine through getMergeEngine() and stays
 * completely engine-agnostic.
 *
 * Entry points do the registering:
 *   ./index.ts   (Node)    registers the native addon at import time.
 *   ./browser.ts (browser) registers wasm inside `await initOptoSync()`.
 */

/**
 * Array merge strategies — the numeric values of the C enum
 * syncer_array_strategy_t.
 *
 * Declared here rather than re-exported from an engine package because these
 * numbers are a wire contract shared with the Dart and Rust clients and with
 * every opto-sync server; they must not depend on which engine happens to be
 * loaded. `test/engine-parity.test.mjs` asserts this map matches both engines'.
 */
export const ArrayStrategy = Object.freeze({
  REPLACE: 0,
  APPEND: 1,
  UNION: 2,
  MERGE_BY_INDEX: 3,
  MERGE_BY_KEY: 4,
});

/**
 * Full merge option surface of the syncer.c core (v0.2.1+), in the camelCase form
 * both engines accept.
 *
 * Note that `undefined` and `''` are different requests: the core reads an
 * absent `lwwKeys` as "use my default" and an absent `arrayMatchKeys` as
 * `"id"`, whereas `''` means "no keys at all". Do not normalize these with
 * `x || ''`.
 */
export interface MergeOptions {
  arrayStrategy?: number;
  arrayMatchKeys?: string;
  maxDepth?: number;
  detectCircularRefs?: boolean;
  resolveByTimestamp?: boolean;
  /** Comma-separated timestamp selectors: direct keys or `#/...` JSON Pointers. */
  lwwKeys?: string;
  /** Comma-separated timestamp selectors: direct keys or `#/...` JSON Pointers. */
  fwwKeys?: string;
}

/**
 * The whole contract the reconcile path needs from a merge engine. Both
 * @opto-sync/syncer and @opto-sync/syncer-wasm satisfy it structurally, so
 * they can be handed over as-is — and so can a test double.
 */
export interface MergeEngine {
  /** Returns merged JSON, or null when either input failed to parse. */
  mergeJson(baseJson: string, incomingJson: string, options?: MergeOptions): string | null;
  /** Version of the underlying syncer.c core, e.g. "0.2.0". */
  version(): string;
}

/** Which flavour of engine is installed. Diagnostics only. */
export type MergeEngineKind = 'native' | 'wasm' | 'custom';

let current: MergeEngine | null = null;
let currentKind: MergeEngineKind | null = null;

/**
 * Install the engine the reconcile path will use. Later calls replace the
 * previous engine, which is what lets a test run the same corpus through both.
 */
export function setMergeEngine(engine: MergeEngine, kind: MergeEngineKind = 'custom'): void {
  if (!engine || typeof engine.mergeJson !== 'function' || typeof engine.version !== 'function') {
    throw new TypeError('opto-sync: a merge engine must provide mergeJson() and version()');
  }
  current = engine;
  currentKind = kind;
}

/** True once an engine is installed. */
export function hasMergeEngine(): boolean {
  return current !== null;
}

/** 'native' | 'wasm' | 'custom', or null before an engine is installed. */
export function mergeEngineKind(): MergeEngineKind | null {
  return currentKind;
}

/**
 * The installed engine.
 *
 * Throws rather than silently degrading: a browser bundle that forgot
 * `await initOptoSync()` would otherwise reconcile with no engine at all, and
 * the failure would surface much later as lost writes.
 */
export function getMergeEngine(): MergeEngine {
  if (!current) {
    throw new Error(
      'opto-sync: no merge engine installed. In a browser, `await initOptoSync()` ' +
        '(from "@opto-sync/client/browser") before reconciling; in Node, import ' +
        '"@opto-sync/client", which installs the native engine for you.',
    );
  }
  return current;
}

/** Test/teardown hook: forget the installed engine. */
export function resetMergeEngine(): void {
  current = null;
  currentKind = null;
}
