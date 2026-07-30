/**
 * RxJS read layer: one deduplicated stream per record.
 *
 * The pattern is local-store-as-single-source-of-truth. Remote bytes (HTTP
 * pull pages, websocket frames) NEVER flow straight into the UI: the sync
 * loop reconciles them through the C merge core into the authoritative local
 * store, and `watchLocalView` renders the store with pending optimistic
 * writes rebased on top. Combining "the streams" therefore reduces to
 * combining two local signals — authoritative state and the pending queue —
 * which makes deduplication exact (canonical-JSON comparison) instead of
 * heuristic (guessing whether an HTTP body and a WS frame are "the same").
 *
 * Practices used deliberately (post-2025 Rx guidance):
 * - `defer` so subscription, not construction, triggers work;
 * - `switchMap` so a superseded rebase computation is dropped, never raced;
 * - `distinctUntilChanged` on canonical JSON for exact dedupe;
 * - `share({ resetOnRefCountZero: true })` so N widgets share one pipeline
 *   and an abandoned stream tears itself down;
 * - no `toPromise` (removed in RxJS 8) — callers use `firstValueFrom`.
 */
import {
  Observable,
  ReplaySubject,
  combineLatest,
  defer,
  from,
  merge,
  of,
  share,
  timer,
  distinctUntilChanged,
  map,
  switchMap,
} from 'rxjs';
import { liveQuery } from 'dexie';

import type { OptoSyncClient } from '../client.js';
import type { JsonRecord, RebaseOptions } from '../reconcile-core.js';
import type {
  ProtocolSyncLoop,
  ProtocolSyncState,
} from '../sync-loop.js';

/**
 * Adapt a Dexie `liveQuery` to an rxjs Observable.
 *
 * Dexie's observable already implements the ES Observable protocol;
 * `from()` upgrades it to rxjs semantics. Emits the current result
 * immediately, then again after any transaction that touches the queried
 * tables.
 */
export function fromLiveQuery<T>(querier: () => T | Promise<T>): Observable<T> {
  return defer(() => from(liveQuery(querier)));
}

/** Emits whenever this client's pending mutation queue changes. */
export function pendingMutationCount$(client: OptoSyncClient): Observable<number> {
  return fromLiveQuery(() =>
    client.db.localMutations.where('syncStatus').equals(0).count(),
  ).pipe(distinctUntilChanged());
}

export interface WatchLocalViewOptions {
  client: OptoSyncClient;
  tableName: string;
  recordId: string;
  /**
   * Authoritative server-state source for this record — typically a
   * `fromLiveQuery` over the application's own store, kept current by the
   * sync loop's `applyChanges`. `undefined` means "not replicated yet".
   */
  authoritative$: Observable<JsonRecord | undefined>;
  rebase?: RebaseOptions;
}

/**
 * The render-ready view of one record: authoritative state with this
 * client's un-pushed writes replayed on top, recomputed whenever either
 * changes, deduplicated on canonical JSON.
 */
export function watchLocalView(
  options: WatchLocalViewOptions,
): Observable<JsonRecord | undefined> {
  const { client, tableName, recordId, authoritative$, rebase } = options;
  const pendingForRecord$ = fromLiveQuery(() =>
    client.db.localMutations
      .where('[tableName+recordId]')
      .equals([tableName, recordId])
      .and((m) => m.syncStatus === 0)
      .toArray(),
  );

  return combineLatest([authoritative$, pendingForRecord$]).pipe(
    switchMap(([server, pending]) => {
      if (server === undefined && pending.length === 0) {
        return of(undefined);
      }
      // localView re-reads the queue itself; passing `pending` through
      // combineLatest is what makes queue changes retrigger the rebase.
      return from(client.localView(tableName, recordId, server ?? {}, rebase));
    }),
    distinctUntilChanged(
      (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null),
    ),
    share({
      connector: () => new ReplaySubject<JsonRecord | undefined>(1),
      resetOnRefCountZero: () => timer(0),
    }),
  );
}

export interface RxSyncHandles {
  loop: ProtocolSyncLoop;
  /** Replay-1 stream of the loop's state (idle/syncing/backoff/...). */
  state$: Observable<ProtocolSyncState>;
}

/**
 * Wrap a ProtocolSyncLoop factory so its state changes become a stream.
 *
 * The loop only reports state through a constructor callback; this helper
 * owns that callback and multiplexes it, preserving any caller-supplied
 * `onStateChange`.
 */
export function createRxSyncLoop(
  build: (onStateChange: (state: ProtocolSyncState) => void) => ProtocolSyncLoop,
): RxSyncHandles {
  const subject = new ReplaySubject<ProtocolSyncState>(1);
  const loop = build((state) => subject.next(state));
  return {
    loop,
    state$: subject.pipe(
      distinctUntilChanged(
        (a, b) =>
          a.status === b.status &&
          a.consecutiveFailures === b.consecutiveFailures &&
          a.nextRetryAt === b.nextRetryAt &&
          a.lastError === b.lastError,
      ),
    ),
  };
}

/**
 * True while anything is still waiting to reach the server — drive "saving…"
 * versus "saved" UI from this, never from individual request promises.
 */
export function hasUnsyncedWork$(client: OptoSyncClient): Observable<boolean> {
  return pendingMutationCount$(client).pipe(
    map((count) => count > 0),
    distinctUntilChanged(),
  );
}

/**
 * Merge external wake-signals (websocket `changed` hints, custom pollers)
 * into loop hints for as long as the returned subscription lives.
 */
export function connectHints(
  loop: Pick<ProtocolSyncLoop, 'hint'>,
  ...signals: Observable<unknown>[]
): { unsubscribe(): void } {
  return merge(...signals).subscribe(() => loop.hint());
}
