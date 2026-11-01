import type { ScopedCollection } from './scoped-collection.ts';

/** Structural subset of TanStack Query's QueryClient; no runtime dependency. */
export interface QueryCacheWriter {
  setQueryData(queryKey: readonly unknown[], value: unknown): unknown;
}

export interface ScopedQueryRow<T> {
  readonly recordId: string;
  readonly value: T;
}

/**
 * Reflect Opto Sync's authoritative-base + durable-optimistic local view into
 * one TanStack Query cache entry. This is a cache bridge, NOT a replacement
 * sync engine or an adapter for TanStack DB's collection lifecycle.
 *
 * Query keys MUST be isolated by application/user/tenant/session/scope.
 * Prefer an app-owned opaque namespace; do not embed raw scopeKey/credentials.
 */
export function bindScopedCollectionToTanstackQuery<T>(
  collection: ScopedCollection<T>,
  client: QueryCacheWriter,
  queryKey: readonly unknown[],
): () => void {
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    throw new RangeError('TanStack Query bridge requires a nonempty query key');
  }
  const key = Object.freeze([...queryKey]);
  return collection.subscribe((view) => {
    // RESET_REQUIRED is not a deletion. Retain cached UI until the new
    // authoritative snapshot is durable and pending writes are rebased.
    if (!view.ready) return;
    const rows: ScopedQueryRow<T>[] = [];
    for (const [recordId, value] of view.rows) {
      rows.push({ recordId, value });
    }
    client.setQueryData(key, rows);
  });
}
