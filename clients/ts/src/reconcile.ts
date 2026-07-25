/**
 * Pure reconciliation logic — no Dexie / IndexedDB dependency.
 *
 * This module only touches the native @opto-sync/syncer merge engine, so it is
 * directly testable (and usable) in plain Node, e.g. on a sync server or in a
 * worker, without any browser storage available.
 */
import { mergeJson, version as coreVersion, ArrayStrategy } from '@opto-sync/syncer';

export { ArrayStrategy };
export type { MergeOptions } from '@opto-sync/syncer';

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
 * @returns The merged payload as a plain object.
 * @throws If either payload does not serialize to valid JSON for the core.
 */
export function reconcileIncoming(
  existingLocalPayload: JsonRecord,
  incomingPayload: JsonRecord,
  options?: ReconcileOptions,
): JsonRecord {
  const baseJson = JSON.stringify(existingLocalPayload);
  const incomingJson = JSON.stringify(incomingPayload);

  const mergedJson = mergeJson(baseJson, incomingJson, resolveReconcileOptions(options));
  if (mergedJson === null) {
    throw new Error('opto-sync: CRDT merge failed (payload was not valid JSON)');
  }

  return JSON.parse(mergedJson) as JsonRecord;
}

/** Version of the underlying native syncer.c core ("major.minor.patch"). */
export function engineVersion(): string {
  return coreVersion();
}
