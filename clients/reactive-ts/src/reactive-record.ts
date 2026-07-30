import {
  EMPTY,
  Observable,
  catchError,
  concatMap,
  defer,
  from,
  merge,
  shareReplay,
  switchMap,
} from 'rxjs';

import type {
  SyncRecordEvent,
  SyncSession,
  SyncSessionIdentity,
} from './contracts.ts';
import {
  recordEventDedupeKey,
  requireAuthenticated,
  sameProjectedValue,
  transportSessionKey,
} from './contracts.ts';

export interface SyncRecordSource<T> {
  name: string;
  events(identity: SyncSessionIdentity): Observable<SyncRecordEvent<T>>;
}

export interface ReactiveRecordSnapshot<T> {
  session: SyncSessionIdentity;
  table: string;
  recordId: string;
  value: T | null;
  local: SyncRecordEvent<T> | null;
  authoritative: SyncRecordEvent<T> | null;
  lastEvent: SyncRecordEvent<T>;
}

export interface ReactiveRecordOptions<T> {
  session$: Observable<SyncSession>;
  table: string;
  recordId: string;
  sources: readonly SyncRecordSource<T>[];
  /**
   * Optional application-specific rebase. The normal implementation calls
   * OptoSyncClient.localView(authoritative, pending local queue).
   */
  project?: (
    authoritative: T | null,
    localView: T | null,
    localPending: boolean,
  ) => T | null | Promise<T | null>;
  sameValue?: (left: T | null, right: T | null) => boolean;
  onSourceError?: (source: string, error: unknown) => void;
  maxRememberedEvents?: number;
}

interface RecordAccumulator<T> {
  local: SyncRecordEvent<T> | null;
  authoritative: SyncRecordEvent<T> | null;
  seen: Map<string, true>;
  value: T | null;
}

function defaultProject<T>(
  authoritative: T | null,
  localView: T | null,
  localPending: boolean,
): T | null {
  if (localPending) return localView;
  return authoritative ?? localView;
}

/**
 * Combine complete local projections with HTTP/WebSocket/TCP/Supabase events.
 *
 * Modern Rx rules encoded here:
 *
 * - `switchMap` tears down every old-session transport on session rotation;
 * - `concatMap` serializes asynchronous rebase/projection work;
 * - cross-transport dedupe happens before projection;
 * - `shareReplay({ bufferSize: 1, refCount: true })` gives late subscribers the
 *   current UI value without pinning sockets/IDB observers after the last view
 *   unsubscribes.
 */
export function createReactiveRecord$<T>(
  options: ReactiveRecordOptions<T>,
): Observable<ReactiveRecordSnapshot<T>> {
  if (options.sources.length === 0) {
    throw new Error('createReactiveRecord$ requires at least one source');
  }
  const project = options.project ?? defaultProject<T>;
  const sameValue = options.sameValue ?? sameProjectedValue<T>;
  const maxRemembered = options.maxRememberedEvents ?? 2048;
  if (!Number.isSafeInteger(maxRemembered) || maxRemembered < 32) {
    throw new RangeError('maxRememberedEvents must be a safe integer >= 32');
  }

  return options.session$.pipe(
    switchMap((session) => {
      const identity = requireAuthenticated(session);
      const generation = transportSessionKey(identity);
      return defer(() => {
        const accumulator: RecordAccumulator<T> = {
          local: null,
          authoritative: null,
          seen: new Map(),
          value: null,
        };
        const streams = options.sources.map((source) =>
          source.events(identity).pipe(
            catchError((error) => {
              options.onSourceError?.(source.name, error);
              return EMPTY;
            }),
          ),
        );

        return merge(...streams).pipe(
          concatMap((event) =>
            from(
              (async (): Promise<ReactiveRecordSnapshot<T> | null> => {
                if (
                  event.sessionPartition !== generation ||
                  event.table !== options.table ||
                  event.recordId !== options.recordId
                ) {
                  return null;
                }
                const key = recordEventDedupeKey(event);
                if (accumulator.seen.has(key)) return null;
                accumulator.seen.set(key, true);
                if (accumulator.seen.size > maxRemembered) {
                  const oldest = accumulator.seen.keys().next().value;
                  if (oldest !== undefined) accumulator.seen.delete(oldest);
                }

                if (event.authority === 'local-view') {
                  accumulator.local = event;
                } else {
                  accumulator.authoritative = event;
                }
                const projected = await project(
                  accumulator.authoritative?.payload ?? null,
                  accumulator.local?.payload ?? null,
                  accumulator.local?.pending === true,
                );
                if (sameValue(accumulator.value, projected) && event !== accumulator.local) {
                  return null;
                }
                accumulator.value = projected;
                return {
                  session: identity,
                  table: options.table,
                  recordId: options.recordId,
                  value: projected,
                  local: accumulator.local,
                  authoritative: accumulator.authoritative,
                  lastEvent: event,
                };
              })(),
            ),
          ),
          // Null means an irrelevant/duplicate/non-observable projection.
          switchMap((snapshot) => (snapshot === null ? EMPTY : [snapshot])),
        );
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}
