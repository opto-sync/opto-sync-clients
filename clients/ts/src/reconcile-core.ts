/**
 * Pure reconciliation logic — engine-agnostic and storage-agnostic.
 *
 * No Dexie, no IndexedDB, and (deliberately) no import of any merge engine:
 * the engine is resolved through the ./engine registry at call time. That is
 * what allows the exact same reconcile code to run against the native N-API
 * addon on a server and against WebAssembly in a browser tab, with no
 * behavioural fork between them.
 *
 * Consumers normally reach this through one of the entry points, which install
 * an engine for them:
 *   - "@opto-sync/client"          (Node, native, synchronous)
 *   - "@opto-sync/client/browser"  (browser, wasm, `await initOptoSync()`)
 */
import { ArrayStrategy, MergeOptions, getMergeEngine } from './engine.js';

export { ArrayStrategy };
export type { MergeOptions, MergeEngine, MergeEngineKind } from './engine.js';
export {
  setMergeEngine,
  getMergeEngine,
  hasMergeEngine,
  mergeEngineKind,
  resetMergeEngine,
} from './engine.js';

/** Full merge option surface of the syncer.c core (v0.2.1+). */
export interface ReconcileOptions {
  /** One of ArrayStrategy.* — REPLACE (0), APPEND (1), UNION (2), MERGE_BY_INDEX (3), MERGE_BY_KEY (4). */
  arrayStrategy?: number;
  /**
   * Comma-separated identity keys for ArrayStrategy.MERGE_BY_KEY
   * (e.g. "uuid,id"). Defaults to "id" in the core.
   */
  arrayMatchKeys?: string;
  /** 0 = unlimited. */
  maxDepth?: number;
  detectCircularRefs?: boolean;
  /** CRDT-like timestamp resolution. Default: true. */
  resolveByTimestamp?: boolean;
  /** Comma-separated Last-Write-Wins keys. Default: "updatedAt,syncedAt". */
  lwwKeys?: string;
  /** Comma-separated First-Write-Wins keys. Default: "createdAt". */
  fwwKeys?: string;
}

/** Client defaults applied on top of the core's own defaults. */
/**
 * Defaults shared with the Dart and Rust clients and with every opto-sync
 * server, so the same document reconciles identically on every tier.
 *
 * `arrayStrategy` must be set explicitly: the native binding's own default is
 * REPLACE, under which an incoming array discards local elements the server
 * never saw and applies elements the timestamp guard should have rejected
 * (element-level resolution only happens under MERGE_BY_KEY).
 */
export const DEFAULT_RECONCILE_OPTIONS: Readonly<ReconcileOptions> = Object.freeze({
  arrayStrategy: ArrayStrategy.MERGE_BY_KEY,
  arrayMatchKeys: 'id',
  resolveByTimestamp: true,
  lwwKeys: 'updatedAt,syncedAt',
  fwwKeys: 'createdAt',
});

export function resolveReconcileOptions(options?: ReconcileOptions): ReconcileOptions {
  return { ...DEFAULT_RECONCILE_OPTIONS, ...options };
}

export type JsonRecord = Record<string, unknown>;

/**
 * Reconcile an incoming (server) payload against the existing local payload.
 *
 * The existing local payload is the merge base; the incoming payload is merged
 * on top, subject to timestamp resolution (stale incoming data loses) and the
 * configured array strategy.
 *
 * Synchronous on every platform: the wasm engine is instantiated up front by
 * `initOptoSync()`, never per call, so this never becomes a promise.
 *
 * @returns The merged payload as a plain object.
 * @throws If either payload does not serialize to valid JSON for the core, or
 *         if no merge engine has been installed yet.
 */
export function reconcileIncoming(
  existingLocalPayload: JsonRecord,
  incomingPayload: JsonRecord,
  options?: ReconcileOptions,
): JsonRecord {
  const baseJson = JSON.stringify(existingLocalPayload);
  const incomingJson = JSON.stringify(incomingPayload);

  const mergedJson = getMergeEngine().mergeJson(
    baseJson,
    incomingJson,
    resolveReconcileOptions(options) as MergeOptions,
  );
  if (mergedJson === null) {
    throw new Error('opto-sync: CRDT merge failed (payload was not valid JSON)');
  }

  return JSON.parse(mergedJson) as JsonRecord;
}

/**
 * Rebase un-confirmed local writes on top of authoritative server state.
 *
 * This is the invariant that makes optimistic writes safe, and it is the same
 * shape every mature sync engine converges on: a pull replaces the base with
 * server state, then every mutation the server has not yet confirmed is
 * replayed on top, so the user never watches their un-pushed edit disappear.
 * Replicache describes it as a git rebase; Linear's engine does the same thing.
 *
 * Why the overlay ignores timestamps by default
 * ---------------------------------------------
 * Engines that replay *mutator functions* get this for free. opto-sync merges
 * *documents* under last-write-wins, so a naive replay reintroduces the exact
 * bug rebase exists to prevent: a pending edit stamped before the server's
 * newer `updatedAt` is rejected as stale and silently vanishes from the view,
 * even though it is still queued and will be pushed later. The record would
 * then flip back once the push lands — a visible flicker and, in between, a UI
 * that contradicts the queue.
 *
 * Pending mutations are by definition this client's own latest intent, not a
 * concurrent writer to arbitrate against, so the overlay applies them
 * unconditionally. Authority still rests with the server: the queued payloads
 * are untouched, and whatever the server decides comes back on the next pull.
 * Pass `gateOverlayByTimestamp: true` to opt into strict gating instead.
 *
 * Pure: no storage, no clock, no I/O.
 *
 * @param serverPayload  Authoritative state from the server (the new base).
 * @param pendingPayloads Un-confirmed local writes, **oldest first**. Order is
 *                        significant — it is the order they will reach the
 *                        server, so it must be the order applied here.
 * @returns The view to render.
 */
export function rebasePending(
  serverPayload: JsonRecord,
  pendingPayloads: readonly JsonRecord[],
  options?: RebaseOptions,
): JsonRecord {
  const { gateOverlayByTimestamp, ...reconcileOptions } = options ?? {};
  const overlayOptions: ReconcileOptions = {
    ...reconcileOptions,
    ...(gateOverlayByTimestamp ? {} : { resolveByTimestamp: false }),
  };

  let view = serverPayload;
  for (const pending of pendingPayloads) {
    view = reconcileIncoming(view, pending, overlayOptions);
  }
  return view;
}

export interface RebaseOptions extends ReconcileOptions {
  /**
   * Subject replayed mutations to the same timestamp gating as server data.
   * Default false — see the note on `rebasePending`. Turning this on means a
   * pending write older than the server's timestamp is dropped from the view
   * while still sitting in the queue.
   */
  gateOverlayByTimestamp?: boolean;
}

/** Version of the underlying syncer.c core ("major.minor.patch"). */
export function engineVersion(): string {
  return getMergeEngine().version();
}
