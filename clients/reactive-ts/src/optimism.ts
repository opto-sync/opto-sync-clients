import type { ConsistencyPolicyId, SyncOptimism, SyncSession } from './contracts.ts';
import {
  SYNC_OPTIMISM,
  requireAuthenticated,
  resolveSyncOptimism,
  storagePartitionKey,
} from './contracts.ts';

export interface LocalDurableWrite<T, R = unknown> {
  /** Commit the app projection and durable opto-sync queue entry atomically. */
  commitLocalAndQueue(value: T): Promise<R>;
  /** Persist a server-confirmed value without creating another pending write. */
  commitAuthoritative(value: T): Promise<void>;
}

export interface RemoteConfirmedWriter<T> {
  write(value: T, signal: AbortSignal): Promise<T>;
}

export interface ForegroundSyncCycle<R = unknown> {
  syncNow(): Promise<R>;
  hint?(): void;
}

export interface OptimisticWriteOptions<T, L = unknown, S = unknown> {
  strategy: SyncOptimism | ConsistencyPolicyId | string;
  session: SyncSession;
  value: T;
  local: LocalDurableWrite<T, L>;
  remote: RemoteConfirmedWriter<T>;
  sync: ForegroundSyncCycle<S>;
  signal?: AbortSignal;
  wakeBackground?: () => void | Promise<void>;
}

export type OptimisticWriteResult<T, L, S> =
  | {
      strategy: 'remote-confirmed';
      status: 'confirmed';
      partition: string;
      authoritative: T;
    }
  | {
      strategy: 'local-durable';
      status: 'queued';
      partition: string;
      localResult: L;
    }
  | {
      strategy: 'local-then-remote';
      status: 'confirmed';
      partition: string;
      localResult: L;
      syncResult: S;
    };

/**
 * Execute one declared optimism level instead of hiding latency/durability
 * trade-offs in framework-specific UI code.
 */
export async function writeWithOptimism<T, L = unknown, S = unknown>(
  options: OptimisticWriteOptions<T, L, S>,
): Promise<OptimisticWriteResult<T, L, S>> {
  const identity = requireAuthenticated(options.session);
  const partition = storagePartitionKey(identity);
  const signal = options.signal ?? new AbortController().signal;
  const strategy = resolveSyncOptimism(options.strategy);

  switch (strategy) {
    case SYNC_OPTIMISM.remoteConfirmed: {
      // Pessimistic/online-only: do not mutate local state until the server has
      // durably accepted and returned the authoritative representation.
      const authoritative = await options.remote.write(options.value, signal);
      await options.local.commitAuthoritative(authoritative);
      return {
        strategy: SYNC_OPTIMISM.remoteConfirmed,
        status: 'confirmed',
        partition,
        authoritative,
      };
    }

    case SYNC_OPTIMISM.localDurable: {
      // Offline-first: the caller's transaction must write the visible row and
      // queue entry together. Background wake-up is only a hint; durability is
      // already complete when this promise resolves.
      const localResult = await options.local.commitLocalAndQueue(options.value);
      options.sync.hint?.();
      await options.wakeBackground?.();
      return {
        strategy: SYNC_OPTIMISM.localDurable,
        status: 'queued',
        partition,
        localResult,
      };
    }

    case SYNC_OPTIMISM.localThenRemote: {
      // Optimistic UI plus a completion boundary for workflows that may render
      // immediately but cannot leave the screen until the protocol cycle lands.
      const localResult = await options.local.commitLocalAndQueue(options.value);
      options.sync.hint?.();
      await options.wakeBackground?.();
      const syncResult = await options.sync.syncNow();
      return {
        strategy: SYNC_OPTIMISM.localThenRemote,
        status: 'confirmed',
        partition,
        localResult,
        syncResult,
      };
    }
  }
}
