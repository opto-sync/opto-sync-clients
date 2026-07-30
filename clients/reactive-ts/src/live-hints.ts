import {
  Observable,
  Subject,
  retry,
  share,
  switchMap,
  timer,
} from 'rxjs';

import {
  SyncHint,
  SyncSession,
  SyncSessionIdentity,
  requireAuthenticated,
  transportSessionKey,
} from './contracts.ts';

export interface WebSocketLike {
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: any) => void): void;
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: any) => void): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketHintOptions {
  session$: Observable<SyncSession>;
  url(identity: SyncSessionIdentity): string;
  protocols?: string | readonly string[];
  create?: (url: string, protocols?: string | readonly string[]) => WebSocketLike;
  decode?: (message: unknown, identity: SyncSessionIdentity) => SyncHint | null;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

function defaultDecode(
  message: unknown,
  identity: SyncSessionIdentity,
): SyncHint | null {
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
    reason: 'remote-change',
    source: 'websocket',
    sessionPartition: transportSessionKey(identity),
    ...(typeof event.table === 'string' ? { table: event.table } : {}),
    ...(typeof event.recordId === 'string' ? { recordId: event.recordId } : {}),
    ...(typeof event.checkpoint === 'string' ? { checkpoint: event.checkpoint } : {}),
  };
}

/** Session rotation tears down the old socket; messages only wake HTTP sync. */
export function createWebSocketHints$(
  options: WebSocketHintOptions,
): Observable<SyncHint> {
  const create =
    options.create ??
    ((url, protocols) => new WebSocket(url, protocols as string | string[] | undefined));
  const decode = options.decode ?? defaultDecode;
  const retryBase = options.retryBaseMs ?? 500;
  const retryMax = options.retryMaxMs ?? 30_000;

  return options.session$.pipe(
    switchMap((session) => {
      const identity = requireAuthenticated(session);
      const url = options.url(identity);
      const parsed = new URL(url);
      if (parsed.protocol !== 'wss:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        throw new Error('opto-sync WebSocket hints require wss outside loopback');
      }
      return new Observable<SyncHint>((subscriber) => {
        const socket = create(url, options.protocols);
        const onMessage = (event: { data?: unknown }) => {
          const hint = decode(event.data, identity);
          if (hint) subscriber.next(hint);
        };
        const onError = () => subscriber.error(new Error('opto-sync WebSocket hint error'));
        const onClose = (event: { code?: number; reason?: string }) => {
          subscriber.error(
            new Error(`opto-sync WebSocket closed (${event.code ?? 0}): ${event.reason ?? ''}`),
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
          delay: (_error, count) =>
            timer(Math.min(retryMax, retryBase * 2 ** Math.min(count - 1, 10))),
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
  subscribe(callback?: (status: string, error?: unknown) => void): SupabaseRealtimeChannelLike;
  unsubscribe(): Promise<unknown> | unknown;
}

export interface SupabaseHintOptions {
  session$: Observable<SyncSession>;
  channel(identity: SyncSessionIdentity): SupabaseRealtimeChannelLike;
  event?: 'postgres_changes' | 'broadcast';
  filter: Record<string, unknown>;
  decode?: (payload: unknown, identity: SyncSessionIdentity) => Partial<SyncHint>;
}

/**
 * Structural adapter for `supabase.channel(...)`. Postgres Changes/Broadcast is
 * a wake-up path only; commit order and dedupe come from the HTTP pull protocol.
 */
export function createSupabaseHints$(
  options: SupabaseHintOptions,
): Observable<SyncHint> {
  return options.session$.pipe(
    switchMap((session) => {
      const identity = requireAuthenticated(session);
      return new Observable<SyncHint>((subscriber) => {
        const channel = options.channel(identity);
        channel
          .on(options.event ?? 'postgres_changes', options.filter, (payload) => {
            const decoded = options.decode?.(payload, identity) ?? {};
            subscriber.next({
              reason: 'remote-change',
              source: 'supabase',
              sessionPartition: transportSessionKey(identity),
              ...decoded,
            });
          })
          .subscribe((status, error) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              subscriber.error(error ?? new Error(`Supabase Realtime ${status}`));
            }
          });
        return () => void channel.unsubscribe();
      });
    }),
    share(),
  );
}
