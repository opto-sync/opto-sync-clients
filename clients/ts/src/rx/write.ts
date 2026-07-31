/**
 * Declarative write strategies ("optimism levels").
 *
 * Every write goes through the same durable queue — the levels differ only in
 * WHAT THE RESOLVED PROMISE MEANS, so a caller can pick per call site:
 *
 * - `'background'`   → resolved: the write is durably queued locally. The
 *   service worker / background worker / next foreground cycle delivers it.
 *   Use for fire-and-forget edits (toggles, drafts, telemetry-ish state).
 * - `'local-first'`  → resolved: durably queued AND a sync cycle was kicked
 *   off immediately (not awaited). The default; snappy UI, eager delivery.
 * - `'await-server'` → resolved: the server has durably acknowledged this
 *   mutation (its watermark covers it). Rejects if the cycle fails or the
 *   row is still pending afterwards. Use for "must be saved before
 *   navigating away" flows — the local write STILL lands first, so even
 *   this level never blocks rendering.
 *
 * There is deliberately no "server-only, skip the queue" level: it would
 * reintroduce the lost-update window the queue exists to close (crash after
 * server accept but before local apply, or vice versa).
 */
import type { OptoSyncClient } from '../client.js';
import type { JsonRecord } from '../reconcile-core.js';
import type { ProtocolMutationOptions } from '../protocol.js';
import type { ProtocolSyncCycleResult, ProtocolSyncLoop } from '../sync-loop.js';
import { SYNC_STATUS } from '../client.js';

export type Optimism = 'background' | 'local-first' | 'await-server';

export interface RxWriteOptions {
  optimism?: Optimism;
  /**
   * Loop used to kick/await delivery. Required for `'await-server'`;
   * optional for `'local-first'` (falls back to the client's queued-mutation
   * trigger, e.g. Background Sync registration).
   */
  loop?: Pick<ProtocolSyncLoop, 'hint' | 'syncNow'>;
  protocol?: ProtocolMutationOptions;
}

export interface WriteReceipt {
  optimism: Optimism;
  /** Row id in the local queue. */
  queuedMutationId: number;
  /** Populated only for `'await-server'`. */
  cycle?: ProtocolSyncCycleResult;
}

export async function write(
  client: OptoSyncClient,
  tableName: string,
  recordId: string,
  payload: JsonRecord,
  options: RxWriteOptions = {},
): Promise<WriteReceipt> {
  const optimism = options.optimism ?? 'local-first';
  if (optimism === 'await-server' && !options.loop) {
    throw new RangeError("optimism 'await-server' requires a sync loop");
  }

  // All levels share the same durable, HLC-stamped queue commit. The
  // client's own onMutationQueued trigger (Background Sync registration,
  // cross-tab hint, ...) fires inside queueMutation for every level.
  const queuedMutationId = await client.queueMutation(
    tableName,
    recordId,
    payload,
    options.protocol,
  );

  if (optimism === 'background') {
    return { optimism, queuedMutationId };
  }

  if (optimism === 'local-first') {
    options.loop?.hint();
    return { optimism, queuedMutationId };
  }

  const cycle = await options.loop!.syncNow();
  const row = await client.db.localMutations.get(queuedMutationId);
  if (row && row.syncStatus === SYNC_STATUS.PENDING) {
    // A concurrent cycle may have raced us and pushed a partial batch;
    // one more single-flight cycle settles this row or fails loudly.
    const retry = await options.loop!.syncNow();
    const after = await client.db.localMutations.get(queuedMutationId);
    if (after && after.syncStatus === SYNC_STATUS.PENDING) {
      throw new Error(
        'server did not acknowledge the mutation within the awaited sync cycles',
      );
    }
    return { optimism, queuedMutationId, cycle: retry };
  }
  return { optimism, queuedMutationId, cycle };
}

export async function writeDelete(
  client: OptoSyncClient,
  tableName: string,
  recordId: string,
  options: RxWriteOptions = {},
): Promise<WriteReceipt> {
  const optimism = options.optimism ?? 'local-first';
  if (optimism === 'await-server' && !options.loop) {
    throw new RangeError("optimism 'await-server' requires a sync loop");
  }
  const queuedMutationId = await client.queueDelete(tableName, recordId, {
    baseRevision: options.protocol?.baseRevision,
  });
  if (optimism === 'background') return { optimism, queuedMutationId };
  if (optimism === 'local-first') {
    options.loop?.hint();
    return { optimism, queuedMutationId };
  }
  const cycle = await options.loop!.syncNow();
  const row = await client.db.localMutations.get(queuedMutationId);
  if (row && row.syncStatus === SYNC_STATUS.PENDING) {
    const retry = await options.loop!.syncNow();
    const after = await client.db.localMutations.get(queuedMutationId);
    if (after && after.syncStatus === SYNC_STATUS.PENDING) {
      throw new Error(
        'server did not acknowledge the delete within the awaited sync cycles',
      );
    }
    return { optimism, queuedMutationId, cycle: retry };
  }
  return { optimism, queuedMutationId, cycle };
}
