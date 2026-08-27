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
 * Canonical wire-neutral identifiers live in `consistency.ts`:
 * remote-acknowledged, write-through-local-first, queued-local-first.
 * `writeWithConsistency` returns typed pending/confirmed/rejected/ambiguous
 * /cancelled outcomes. Legacy `write` keeps its original throw/receipt shape.
 */
import type { OptoSyncClient } from '../client.js';
import type { JsonRecord } from '../reconcile-core.js';
import type { ProtocolMutationOptions } from '../protocol.js';
import type { ProtocolSyncCycleResult, ProtocolSyncLoop } from '../sync-loop.js';
import { SYNC_STATUS } from '../client.js';
import {
  CONSISTENCY_POLICY,
  canonicalizeConsistencyPolicy,
  outcomeForNetwork,
  type ConsistencyOutcome,
  type ConsistencyPolicyId,
} from '../consistency.js';

export type Optimism = 'background' | 'local-first' | 'await-server';

const OPTIMISM_TO_POLICY: Record<Optimism, ConsistencyPolicyId> = {
  background: CONSISTENCY_POLICY.queuedLocalFirst,
  'local-first': CONSISTENCY_POLICY.writeThroughLocalFirst,
  'await-server': CONSISTENCY_POLICY.remoteAcknowledged,
};

export interface RxWriteOptions {
  optimism?: Optimism;
  /**
   * Canonical or aliased consistency policy. When omitted, `optimism`
   * (default `local-first`) selects the reviewed mapping.
   */
  consistency?: string;
  /**
   * Loop used to kick/await delivery. Required for `'await-server'`;
   * optional for `'local-first'` (falls back to the client's queued-mutation
   * trigger, e.g. Background Sync registration).
   */
  loop?: Pick<ProtocolSyncLoop, 'hint' | 'syncNow'>;
  protocol?: ProtocolMutationOptions;
  signal?: AbortSignal;
}

export interface WriteReceipt {
  optimism: Optimism;
  /** Row id in the local queue. */
  queuedMutationId: number;
  /** Populated only for `'await-server'`. */
  cycle?: ProtocolSyncCycleResult;
  /** Canonical policy stored on the durable intent. */
  consistencyPolicy?: ConsistencyPolicyId;
}

export interface ConsistencyWriteReceipt extends ConsistencyOutcome {
  queuedMutationId: number;
  cycle?: ProtocolSyncCycleResult;
}

function protocolWithPolicy(
  protocol: ProtocolMutationOptions | undefined,
  policy: ConsistencyPolicyId,
): ProtocolMutationOptions {
  return { ...protocol, consistencyPolicy: policy };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
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
  const consistencyPolicy = canonicalizeConsistencyPolicy(
    options.consistency ?? OPTIMISM_TO_POLICY[optimism],
  );

  // All levels share the same durable, HLC-stamped queue commit. The
  // client's own onMutationQueued trigger (Background Sync registration,
  // cross-tab hint, ...) fires inside queueMutation for every level.
  const queuedMutationId = await client.queueMutation(
    tableName,
    recordId,
    payload,
    protocolWithPolicy(options.protocol, consistencyPolicy),
  );

  if (optimism === 'background') {
    return { optimism, queuedMutationId, consistencyPolicy };
  }

  if (optimism === 'local-first') {
    options.loop?.hint();
    return { optimism, queuedMutationId, consistencyPolicy };
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
    return { optimism, queuedMutationId, cycle: retry, consistencyPolicy };
  }
  return { optimism, queuedMutationId, cycle, consistencyPolicy };
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
  const consistencyPolicy = canonicalizeConsistencyPolicy(
    options.consistency ?? OPTIMISM_TO_POLICY[optimism],
  );
  const queuedMutationId = await client.queueDelete(tableName, recordId, {
    baseRevision: options.protocol?.baseRevision,
    consistencyPolicy,
  });
  if (optimism === 'background') {
    return { optimism, queuedMutationId, consistencyPolicy };
  }
  if (optimism === 'local-first') {
    options.loop?.hint();
    return { optimism, queuedMutationId, consistencyPolicy };
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
    return { optimism, queuedMutationId, cycle: retry, consistencyPolicy };
  }
  return { optimism, queuedMutationId, cycle, consistencyPolicy };
}

async function settleConsistency(
  client: OptoSyncClient,
  queuedMutationId: number,
  policy: ConsistencyPolicyId,
  options: RxWriteOptions,
): Promise<ConsistencyWriteReceipt> {
  if (options.signal?.aborted) {
    return {
      ...outcomeForNetwork(policy, 'cancelled'),
      queuedMutationId,
    };
  }
  if (policy === CONSISTENCY_POLICY.queuedLocalFirst) {
    return {
      ...outcomeForNetwork(policy, 'not-attempted'),
      queuedMutationId,
    };
  }
  if (!options.loop) {
    if (policy === CONSISTENCY_POLICY.remoteAcknowledged) {
      throw new RangeError(
        'remote-acknowledged consistency requires a sync loop',
      );
    }
    return {
      ...outcomeForNetwork(policy, 'not-attempted'),
      queuedMutationId,
    };
  }
  options.loop.hint();
  try {
    const cycle = await options.loop.syncNow();
    const row = await client.db.localMutations.get(queuedMutationId);
    if (row && row.syncStatus === SYNC_STATUS.FAILED) {
      return {
        ...outcomeForNetwork(policy, 'rejected', [row.mutationId ?? '']),
        queuedMutationId,
        cycle,
      };
    }
    if (row && row.syncStatus === SYNC_STATUS.PENDING) {
      const retry = await options.loop.syncNow();
      const after = await client.db.localMutations.get(queuedMutationId);
      if (after && after.syncStatus === SYNC_STATUS.PENDING) {
        return {
          ...outcomeForNetwork(policy, 'response-lost'),
          queuedMutationId,
          cycle: retry,
        };
      }
      return {
        ...outcomeForNetwork(policy, 'acked', [
          after?.mutationId ?? row.mutationId ?? '',
        ]),
        queuedMutationId,
        cycle: retry,
      };
    }
    return {
      ...outcomeForNetwork(policy, 'acked', [row?.mutationId ?? '']),
      queuedMutationId,
      cycle,
    };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      return {
        ...outcomeForNetwork(policy, 'cancelled'),
        queuedMutationId,
      };
    }
    return {
      ...outcomeForNetwork(policy, 'response-lost'),
      queuedMutationId,
    };
  }
}

/**
 * Queue one mutation under a caller-selected consistency policy and return a
 * typed outcome. Policy identity is frozen on the durable intent.
 */
export async function writeWithConsistency(
  client: OptoSyncClient,
  tableName: string,
  recordId: string,
  payload: JsonRecord,
  options: RxWriteOptions = {},
): Promise<ConsistencyWriteReceipt> {
  const policy = canonicalizeConsistencyPolicy(
    options.consistency ??
      OPTIMISM_TO_POLICY[options.optimism ?? 'local-first'],
  );
  const queuedMutationId = await client.queueMutation(
    tableName,
    recordId,
    payload,
    protocolWithPolicy(options.protocol, policy),
  );
  return settleConsistency(client, queuedMutationId, policy, options);
}

export async function writeDeleteWithConsistency(
  client: OptoSyncClient,
  tableName: string,
  recordId: string,
  options: RxWriteOptions = {},
): Promise<ConsistencyWriteReceipt> {
  const policy = canonicalizeConsistencyPolicy(
    options.consistency ??
      OPTIMISM_TO_POLICY[options.optimism ?? 'local-first'],
  );
  const queuedMutationId = await client.queueDelete(tableName, recordId, {
    baseRevision: options.protocol?.baseRevision,
    consistencyPolicy: policy,
  });
  return settleConsistency(client, queuedMutationId, policy, options);
}
