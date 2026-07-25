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

/** Full merge option surface of the syncer.c v0.2.0 core. */
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

/** Version of the underlying syncer.c core ("major.minor.patch"). */
export function engineVersion(): string {
  return getMergeEngine().version();
}
