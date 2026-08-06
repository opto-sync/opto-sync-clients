import {
  Observable,
  ReplaySubject,
  Subscription,
  concatMap,
  defer,
  distinctUntilChanged,
  filter,
  from,
  map,
  merge,
  of,
  share,
  startWith,
  switchMap,
} from 'rxjs';

import type { JsonRecord } from './reconcile-core.js';
import type { OptoSyncClient } from './client.js';

export type ReactiveSyncSource =
  | 'indexeddb'
  | 'sqlite'
  | 'http'
  | 'websocket'
  | 'tcp'
  | 'supabase'
  | 'blob'
  | (string & {});

export interface SyncRecordEnvelope<T extends JsonRecord = JsonRecord> {
  tableName: string;
  recordId: string;
  source: ReactiveSyncSource;
  record: T | null;
  /** Server revision, checkpoint, ETag, HLC, or another diagnostic cursor. */
  version?: string;
  receivedAt?: number;
}

export interface ReactiveRecordOptions<T extends JsonRecord = JsonRecord> {
  client: Pick<OptoSyncClient, 'reconcileIncoming' | 'localView'>;
  tableName: string;
  recordId: string;
  sources: readonly Observable<SyncRecordEnvelope<T>>[];
  initial?: T | null;
  /**
   * Render the pending durable queue over the merged authoritative candidate.
   * The default uses `OptoSyncClient.localView`.
   */
  renderLocal?: (authoritative: T) => Promise<T | null>;
  equals?: (left: T | null, right: T | null) => boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable structural fingerprint used only for emission de-duplication. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Merge local database, HTTP, WebSocket, TCP, Supabase, and blob streams into
 * one record stream, then replay pending optimistic intent before emitting.
 *
 * `concatMap` intentionally serializes async queue reads. `switchMap` here
 * would discard an older merge after its promise had already mutated the
 * accumulator, producing a view that was never emitted. The shared replay
 * buffer is reset when the last subscriber leaves, avoiding a process-lifetime
 * cache for every record ever opened.
 */
export function createReactiveRecord$<T extends JsonRecord>(
  options: ReactiveRecordOptions<T>,
): Observable<T | null> {
  if (options.sources.length === 0 && options.initial === undefined) {
    return of(null);
  }
  const equals =
    options.equals ??
    ((left: T | null, right: T | null) =>
      canonicalJson(left) === canonicalJson(right));

  const cold = defer(() => {
    let authoritative = options.initial ?? null;
    const source$ =
      options.sources.length === 0
        ? of<SyncRecordEnvelope<T>>({
            tableName: options.tableName,
            recordId: options.recordId,
            source: 'blob',
            record: authoritative,
          })
        : merge(...options.sources);

    return source$.pipe(
      filter(
        (event) =>
          event.tableName === options.tableName &&
          event.recordId === options.recordId,
      ),
      concatMap(async (event): Promise<T | null> => {
        if (event.record === null) {
          authoritative = null;
          return null;
        }
        authoritative =
          authoritative === null
            ? event.record
            : (options.client.reconcileIncoming(
                options.tableName,
                options.recordId,
                event.record,
                authoritative,
              ) as T);
        if (options.renderLocal) return options.renderLocal(authoritative);
        return options.client.localView(
          options.tableName,
          options.recordId,
          authoritative,
        ) as Promise<T>;
      }),
    );
  });

  return cold.pipe(
    distinctUntilChanged(equals),
    share({
      connector: () => new ReplaySubject<T | null>(1),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    }),
  );
}

export interface RefreshContext {
  signal: AbortSignal;
}

/**
 * Convert realtime messages into cancellable authoritative HTTP refreshes.
 *
 * The first fetch happens immediately. A newer hint aborts the prior request;
 * stale responses therefore cannot arrive after and overwrite a newer fetch.
 */
export function createRemoteRefresh$<T>(
  hints$: Observable<unknown>,
  load: (context: RefreshContext) => Promise<T>,
): Observable<T> {
  return hints$.pipe(
    startWith(undefined),
    switchMap(
      () =>
        new Observable<T>((subscriber) => {
          const controller = new AbortController();
          void load({ signal: controller.signal }).then(
            (value) => {
              if (!controller.signal.aborted) {
                subscriber.next(value);
                subscriber.complete();
              }
            },
            (error) => {
              if (!controller.signal.aborted) subscriber.error(error);
            },
          );
          return () => controller.abort();
        }),
    ),
    share({
      connector: () => new ReplaySubject<T>(1),
      resetOnError: true,
      resetOnComplete: false,
      resetOnRefCountZero: true,
    }),
  );
}

export interface SyncHint {
  source: 'websocket' | 'tcp' | 'supabase' | (string & {});
  receivedAt: number;
  data?: unknown;
}

export interface WebSocketHintsOptions {
  protocols?: string | string[];
  WebSocket?: typeof globalThis.WebSocket;
  retryBaseMs?: number;
  retryMaxMs?: number;
  decode?: (event: MessageEvent) => unknown;
}

/**
 * Reconnecting WebSocket hint stream.
 *
 * Socket payloads are deliberately not treated as an ordered change log.
 * Every message wakes an HTTP pull, which closes gaps after sleep/reconnect.
 */
export function webSocketSyncHints$(
  url: string | URL,
  options: WebSocketHintsOptions = {},
): Observable<SyncHint> {
  return new Observable<SyncHint>((subscriber) => {
    const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
    if (typeof WebSocketImpl !== 'function') {
      subscriber.error(new Error('WebSocket is unavailable in this runtime'));
      return;
    }
    const base = options.retryBaseMs ?? 500;
    const maximum = options.retryMaxMs ?? 30_000;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = options.protocols
        ? new WebSocketImpl(url, options.protocols)
        : new WebSocketImpl(url);
      socket.addEventListener('open', () => {
        failures = 0;
        subscriber.next({ source: 'websocket', receivedAt: Date.now() });
      });
      socket.addEventListener('message', (event) => {
        let data: unknown = event.data;
        if (options.decode) {
          try {
            data = options.decode(event);
          } catch {
            return;
          }
        }
        subscriber.next({
          source: 'websocket',
          receivedAt: Date.now(),
          data,
        });
      });
      socket.addEventListener('close', () => {
        if (stopped) return;
        failures += 1;
        const delay = Math.min(maximum, base * 2 ** Math.min(failures - 1, 30));
        timer = setTimeout(connect, Math.random() * delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      socket?.close();
    };
  }).pipe(
    share({
      connector: () => new ReplaySubject<SyncHint>(1),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    }),
  );
}

/**
 * Attach any live hint stream to `ProtocolSyncLoop.hint`.
 *
 * Errors stay observational: the durable loop will still run from local-write,
 * online, visibility, service-worker, or mobile scheduler wakeups.
 */
export function connectSyncHints(
  hints$: Observable<unknown>,
  hint: () => void,
  onError?: (error: unknown) => void,
): Subscription {
  return hints$.subscribe({
    next: () => hint(),
    error: (error) => onError?.(error),
  });
}

export enum OptimismLevel {
  /** Send to the server first and return only after its response is installed. */
  ServerConfirmed = 'server-confirmed',
  /** Commit locally and return; a service/mobile worker performs network I/O. */
  DurableLocal = 'durable-local',
  /** Commit locally, start a sync cycle immediately, and await that cycle. */
  DurableLocalAndWait = 'durable-local-and-wait',
}

export interface ReactiveWriteOptions<RemoteResult, LocalResult> {
  optimism: OptimismLevel;
  remoteWrite: () => Promise<RemoteResult>;
  queueLocal: () => Promise<LocalResult>;
  installRemote?: (result: RemoteResult) => Promise<void>;
  requestBackgroundSync?: () => void | Promise<void>;
  syncNow?: () => Promise<unknown>;
}

export type ReactiveWriteResult<RemoteResult, LocalResult> =
  | {
      optimism: OptimismLevel.ServerConfirmed;
      remote: RemoteResult;
    }
  | {
      optimism:
        | OptimismLevel.DurableLocal
        | OptimismLevel.DurableLocalAndWait;
      local: LocalResult;
    };

/**
 * Execute one write under an explicit optimism policy.
 *
 * A failed immediate sync never removes the durable local mutation. Callers
 * may surface that error while the same idempotent mutation remains available
 * to the background worker.
 */
export async function executeReactiveWrite<RemoteResult, LocalResult>(
  options: ReactiveWriteOptions<RemoteResult, LocalResult>,
): Promise<ReactiveWriteResult<RemoteResult, LocalResult>> {
  if (options.optimism === OptimismLevel.ServerConfirmed) {
    const remote = await options.remoteWrite();
    await options.installRemote?.(remote);
    return { optimism: options.optimism, remote };
  }

  const local = await options.queueLocal();
  await options.requestBackgroundSync?.();
  if (options.optimism === OptimismLevel.DurableLocalAndWait) {
    if (!options.syncNow) {
      throw new TypeError('durable-local-and-wait requires syncNow');
    }
    await options.syncNow();
  }
  return { optimism: options.optimism, local };
}

/** Adapt a plain promise-producing source into a typed single-value stream. */
export function fromAsync<T>(factory: () => Promise<T>): Observable<T> {
  return defer(() => from(factory()));
}

/** Map a record value into an envelope without losing source metadata. */
export function envelopeMap<T extends JsonRecord>(
  tableName: string,
  recordId: string,
  source: ReactiveSyncSource,
): (record: T | null) => SyncRecordEnvelope<T> {
  return (record) => ({
    tableName,
    recordId,
    source,
    record,
    receivedAt: Date.now(),
  });
}

/** Convenience operator for an already-typed value stream. */
export function toRecordEnvelopes<T extends JsonRecord>(
  values$: Observable<T | null>,
  tableName: string,
  recordId: string,
  source: ReactiveSyncSource,
): Observable<SyncRecordEnvelope<T>> {
  return values$.pipe(map(envelopeMap(tableName, recordId, source)));
}
