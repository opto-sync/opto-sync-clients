import {
  defer,
  from,
  Observable,
  Subject,
  retry,
  share,
  switchMap,
  timer,
} from 'rxjs';
import type { SchedulerLike } from 'rxjs';

import {
  requireAuthenticated,
  transportSessionKey,
} from './contracts.ts';
import type {
  SyncHint,
  SyncSession,
  SyncSessionIdentity,
} from './contracts.ts';

export interface WebSocketLike {
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
  ): void;
  close(code?: number, reason?: string): void;
}

/**
 * Untrusted live transports may suggest only routing/checkpoint metadata.
 * Source, reason, and session ownership are always supplied by opto-sync.
 */
export type DecodedSyncHint = Partial<
  Pick<SyncHint, 'table' | 'recordId' | 'checkpoint'>
>;

export interface WebSocketHintOptions {
  session$: Observable<SyncSession>;
  url(identity: SyncSessionIdentity): string;
  protocols?: string | readonly string[];
  create?: (
    url: string,
    protocols?: string | readonly string[],
  ) => WebSocketLike;
  decode?: (
    message: unknown,
    identity: SyncSessionIdentity,
  ) => DecodedSyncHint | null;
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryAttempts?: number;
  retryScheduler?: SchedulerLike;
}

function defaultDecode(message: unknown): DecodedSyncHint | null {
  let value: unknown = message;
  if (typeof message === 'string') {
    try {
      value = JSON.parse(message);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  return {
    ...(typeof event.table === 'string' ? { table: event.table } : {}),
    ...(typeof event.recordId === 'string'
      ? { recordId: event.recordId }
      : {}),
    ...(typeof event.checkpoint === 'string'
      ? { checkpoint: event.checkpoint }
      : {}),
  };
}

function retryOptions(options: {
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryAttempts?: number;
}): { retryBase: number; retryMax: number; retryAttempts: number } {
  const retryBase = options.retryBaseMs ?? 500;
  const retryMax = options.retryMaxMs ?? 30_000;
  const retryAttempts = options.retryAttempts ?? 8;
  if (!Number.isFinite(retryBase) || retryBase < 0) {
    throw new RangeError('retryBaseMs must be a non-negative finite number');
  }
  if (!Number.isFinite(retryMax) || retryMax < retryBase) {
    throw new RangeError('retryMaxMs must be finite and >= retryBaseMs');
  }
  if (!Number.isSafeInteger(retryAttempts) || retryAttempts < 0) {
    throw new RangeError('retryAttempts must be a non-negative safe integer');
  }
  return { retryBase, retryMax, retryAttempts };
}

function retryDelay(
  retryBase: number,
  retryMax: number,
  count: number,
): number {
  return Math.min(
    retryMax,
    retryBase * 2 ** Math.min(Math.max(0, count - 1), 10),
  );
}

/** Session rotation tears down the old socket; messages only wake HTTP sync. */
export function createWebSocketHints$(
  options: WebSocketHintOptions,
): Observable<SyncHint> {
  const create =
    options.create ??
    ((url, protocols) =>
      new WebSocket(url, protocols as string | string[] | undefined));
  const decode = options.decode ?? defaultDecode;
  const { retryBase, retryMax, retryAttempts } = retryOptions(options);

  return options.session$.pipe(
    switchMap((session) => {
      const identity = requireAuthenticated(session);
      const url = options.url(identity);
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'wss:' &&
        parsed.hostname !== '127.0.0.1' &&
        parsed.hostname !== 'localhost'
      ) {
        throw new Error(
          'opto-sync WebSocket hints require wss outside loopback',
        );
      }
      const sessionPartition = transportSessionKey(identity);
      return new Observable<SyncHint>((subscriber) => {
        const socket = create(url, options.protocols);
        const onMessage = (event: { data?: unknown }) => {
          const decoded = decode(event.data, identity);
          if (!decoded) return;
          subscriber.next({
            ...decoded,
            reason: 'remote-change',
            source: 'websocket',
            sessionPartition,
          });
        };
        const onError = () =>
          subscriber.error(new Error('opto-sync WebSocket hint error'));
        const onClose = (event: { code?: number; reason?: string }) => {
          subscriber.error(
            new Error(
              `opto-sync WebSocket closed (code=${
                Number.isSafeInteger(event.code) ? event.code : 0
              })`,
            ),
          );
        };
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
        return () => {
          socket.removeEventListener('message', onMessage);
          socket.removeEventListener('error', onError);
          socket.removeEventListener('close', onClose);
          socket.close(1000, 'session changed or subscriber left');
        };
      }).pipe(
        retry({
          count: retryAttempts,
          delay: (_error, count) =>
            timer(
              retryDelay(retryBase, retryMax, count),
              options.retryScheduler,
            ),
        }),
      );
    }),
    share({
      connector: () => new Subject<SyncHint>(),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    }),
  );
}

export interface SupabaseRealtimeChannelLike {
  on(
    type: 'postgres_changes' | 'broadcast',
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): SupabaseRealtimeChannelLike;
  subscribe(
    callback?: (status: string, error?: unknown) => void,
  ): SupabaseRealtimeChannelLike;
  unsubscribe(): Promise<unknown> | unknown;
}

/** Structural subset of `supabase.realtime` used for JWT refresh. */
export interface SupabaseRealtimeAuthLike {
  setAuth(accessToken?: string): Promise<unknown> | unknown;
}

/**
 * Supplies a fresh token before every initial connection and retry.
 *
 * Keep bearer tokens outside SyncSessionIdentity and durable IndexedDB state.
 * Passing `supabase.realtime` plus `supabase.auth.getSession()`-backed token
 * retrieval is the normal Supabase Auth adapter. Shared-auth integrations may
 * provide their own short-lived Supabase JWT exchange.
 */
export interface SupabaseRealtimeAuthBinding {
  realtime: SupabaseRealtimeAuthLike;
  accessToken(
    identity: SyncSessionIdentity,
  ): string | Promise<string>;
}

export interface SupabaseHintOptions {
  session$: Observable<SyncSession>;
  channel(identity: SyncSessionIdentity): SupabaseRealtimeChannelLike;
  /**
   * Explicit auth refresh binding. Supply this for Shared-Auth/external JWTs.
   * It may be omitted only when the Supabase client owns auth refresh itself.
   */
  auth?: SupabaseRealtimeAuthBinding;
  event?: 'postgres_changes' | 'broadcast';
  filter: Record<string, unknown>;
  decode?: (
    payload: unknown,
    identity: SyncSessionIdentity,
  ) => DecodedSyncHint;
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryAttempts?: number;
  retryScheduler?: SchedulerLike;
}

async function refreshSupabaseAuth(
  auth: SupabaseRealtimeAuthBinding,
  identity: SyncSessionIdentity,
): Promise<void> {
  let token: string;
  try {
    token = await auth.accessToken(identity);
  } catch {
    throw new Error('Supabase Realtime access-token refresh failed');
  }
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token !== token.trim()
  ) {
    throw new Error(
      'Supabase Realtime access-token refresh returned an invalid token',
    );
  }
  try {
    await auth.realtime.setAuth(token);
  } catch {
    throw new Error('Supabase Realtime authentication update failed');
  }
}

function ignoreUnsubscribeFailure(result: Promise<unknown> | unknown): void {
  if (
    result &&
    typeof result === 'object' &&
    'then' in result &&
    typeof (result as PromiseLike<unknown>).then === 'function'
  ) {
    void Promise.resolve(result).catch(() => {
      // Teardown diagnostics must not create unhandled promise rejections.
    });
  }
}

/**
 * Structural adapter for `supabase.channel(...)`.
 *
 * Postgres Changes/Broadcast is a wake-up path only; commit order and dedupe
 * come from the authenticated HTTP push/pull protocol. Callers should pass a
 * dedicated Supabase client/channel for entity synchronization rather than
 * sharing the ORES OTEL telemetry WebSocket.
 */
export function createSupabaseHints$(
  options: SupabaseHintOptions,
): Observable<SyncHint> {
  const { retryBase, retryMax, retryAttempts } = retryOptions(options);

  return options.session$.pipe(
    switchMap((session) => {
      const identity = requireAuthenticated(session);
      const sessionPartition = transportSessionKey(identity);

      const channelAttempt$ = () =>
        new Observable<SyncHint>((subscriber) => {
          let intentionalTeardown = false;
          let failed = false;
          let channel: SupabaseRealtimeChannelLike;
          try {
            channel = options.channel(identity);
          } catch {
            subscriber.error(
              new Error('Supabase Realtime channel creation failed'),
            );
            return;
          }

          const fail = (status: string) => {
            if (failed || intentionalTeardown || subscriber.closed) return;
            failed = true;
            subscriber.error(
              new Error(`Supabase Realtime channel ${status}`),
            );
          };

          try {
            channel
              .on(
                options.event ?? 'postgres_changes',
                options.filter,
                (payload) => {
                  if (intentionalTeardown || subscriber.closed) return;
                  let decoded: DecodedSyncHint;
                  try {
                    decoded = options.decode?.(payload, identity) ?? {};
                  } catch {
                    fail('DECODE_ERROR');
                    return;
                  }
                  subscriber.next({
                    ...decoded,
                    reason: 'remote-change',
                    source: 'supabase',
                    sessionPartition,
                  });
                },
              )
              .subscribe((status) => {
                if (
                  status === 'CHANNEL_ERROR' ||
                  status === 'TIMED_OUT' ||
                  status === 'CLOSED'
                ) {
                  fail(status);
                }
              });
          } catch {
            fail('SUBSCRIBE_ERROR');
          }

          return () => {
            intentionalTeardown = true;
            try {
              ignoreUnsubscribeFailure(channel.unsubscribe());
            } catch {
              // Teardown is best-effort; the closed subscriber fences callbacks.
            }
          };
        });

      const authenticatedAttempt$ = () =>
        options.auth
          ? defer(() => from(refreshSupabaseAuth(options.auth!, identity))).pipe(
              switchMap(channelAttempt$),
            )
          : channelAttempt$();

      return defer(authenticatedAttempt$).pipe(
        retry({
          count: retryAttempts,
          delay: (_error, count) =>
            timer(
              retryDelay(retryBase, retryMax, count),
              options.retryScheduler,
            ),
        }),
      );
    }),
    share({
      connector: () => new Subject<SyncHint>(),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    }),
  );
}
