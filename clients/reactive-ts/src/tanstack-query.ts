import type { Observable, Subscription } from 'rxjs';
import type { SyncSessionIdentity } from './contracts.ts';
import { storagePartitionKey } from './contracts.ts';
import type { ReactiveRecordSnapshot } from './reactive-record.ts';

/** Small structural subset of TanStack Query's QueryClient; no runtime coupling. */
export interface TanStackQueryClientPort {
  setQueryData<T>(queryKey: readonly unknown[], value: T): unknown;
}

export interface OptoTanStackQueryBridgeOptions<T> {
  queryClient: TanStackQueryClientPort;
  records$: Observable<ReactiveRecordSnapshot<T>>;
  /** Authenticated identity owning the cache entry; never a bearer token. */
  identity: SyncSessionIdentity;
  /** Application query key, without the Opto Sync partition prefix. */
  queryKey: readonly unknown[];
  /** Query cache is a projection, never an acknowledgement authority. */
  onError?: (error: unknown) => void;
}

export interface OptoTanStackQueryBinding {
  queryKey: readonly unknown[];
  unsubscribe(): void;
}

/**
 * A stable, tenant/user-partitioned TanStack Query key. Excludes session
 * credentials, token values and refreshable session id by design.
 */
export function optoScopedQueryKey(
  identity: SyncSessionIdentity,
  queryKey: readonly unknown[],
): readonly unknown[] {
  return Object.freeze(['opto-sync', storagePartitionKey(identity), ...queryKey]);
}

/**
 * Present Opto Sync localView snapshots through a TanStack Query cache.
 * The cache receives already-rebased values, not raw Electric/HTTP rows.
 * This deliberately does not call invalidateQueries or acknowledge pushes:
 * callers keep those operations bound to the authoritative sync protocol.
 */
export function bindOptoToTanStackQuery<T>(
  options: OptoTanStackQueryBridgeOptions<T>,
): OptoTanStackQueryBinding {
  const partition = storagePartitionKey(options.identity);
  const queryKey = optoScopedQueryKey(options.identity, options.queryKey);
  const subscription: Subscription = options.records$.subscribe({
    next: (snapshot) => {
      if (storagePartitionKey(snapshot.session) !== partition) {
        options.onError?.(new Error('refused cross-partition TanStack cache update'));
        return;
      }
      try {
        options.queryClient.setQueryData<T | null>(queryKey, snapshot.value);
      } catch (error) {
        options.onError?.(error);
      }
    },
    error: (error) => options.onError?.(error),
  });
  return { queryKey, unsubscribe: () => subscription.unsubscribe() };
}
