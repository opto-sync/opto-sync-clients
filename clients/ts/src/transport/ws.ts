/**
 * WebSocket implementation of {@link ProtocolTransport}.
 *
 * Wire contract (shared with the reference node server and the Dart/Rust
 * clients — do not deviate):
 * - endpoint `/sync/ws`, JSON text frames, one JSON object per frame.
 * - client→server: `{"v":1,"type":"push"|"pull"|"snapshot","requestId":"<unique>", ...body}`
 * - server→client: `{"v":1,"type":"push-result"|"pull-result"|"snapshot-result","requestId",...body}`,
 *   `{"v":1,"type":"error","requestId","code","message","retryable?"}`, and the
 *   unsolicited pull hint `{"v":1,"type":"changed","watermark":<number>}`.
 *
 * The transport is lazy: it dials on the first request, correlates concurrent
 * requests by `requestId`, and reconnects with full-jitter exponential backoff
 * while the caller's sync loop is the one deciding when to retry a failed
 * request. `changed` hints reach the application through `onChanged`, which
 * should call `ProtocolSyncLoop.hint()` — hints are wake-ups, never data.
 */
import {
  ProtocolTransport,
  ResetRequired,
  SyncTransportError,
  computeRetryDelay,
} from '../sync-loop.js';
import type {
  PullResponse,
  PushRequest,
  PushResponse,
  SnapshotResponse,
} from '../protocol.js';

/** Structural WebSocket so Node (ws / undici), browsers, and tests all fit. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
}

/** Supplies a bearer token for the connection URL. Return null for none. */
export interface AuthTokenProvider {
  getToken(): Promise<string | null> | string | null;
}

export interface WebSocketTransportOptions {
  /** Absolute or origin-relative URL of the `/sync/ws` endpoint. */
  url: string;
  /**
   * Constructor/factory for sockets. Defaults to `globalThis.WebSocket`.
   * Injectable for Node (`ws`) and for tests.
   */
  webSocketFactory?: (url: string) => WebSocketLike;
  /**
   * Pluggable session source (Supabase session, shared-auth, …). The token is
   * appended as a `token` query parameter at dial time, so an expired token
   * picks up its replacement on the next reconnect.
   */
  auth?: AuthTokenProvider;
  /** Reject an in-flight request after this long. Default 20s. */
  requestTimeoutMs?: number;
  /** Called for every unsolicited `changed` frame. Wire to `loop.hint()`. */
  onChanged?: (watermark: number) => void;
  /**
   * Used when the socket cannot be established (or for `snapshot` if the
   * server only serves snapshots over HTTP). Typical value: the HTTP
   * transport. Without a fallback, failures surface as retryable transport
   * errors and the sync loop backs off.
   */
  fallback?: ProtocolTransport;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  random?: () => number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface PendingRequest {
  resolve: (frame: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const OPEN = 1;

function frameError(frame: Record<string, unknown>): SyncTransportError {
  return new SyncTransportError(
    typeof frame.message === 'string' ? frame.message : 'sync websocket error',
    frame.retryable !== false,
    undefined,
    typeof frame.code === 'string' ? frame.code : 'WS_ERROR',
  );
}

export class WebSocketTransport implements ProtocolTransport {
  private socket: WebSocketLike | undefined;
  private connecting: Promise<WebSocketLike> | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 0;
  private consecutiveDialFailures = 0;
  private disposed = false;
  private readonly seed = Math.random().toString(36).slice(2, 10);

  constructor(private readonly options: WebSocketTransportOptions) {
    if (!options.url) throw new RangeError('WebSocketTransport requires a url');
  }

  async push(request: PushRequest, signal: AbortSignal): Promise<PushResponse> {
    const frame = await this.request('push', request as unknown as Record<string, unknown>, signal);
    return frame as unknown as PushResponse;
  }

  async pull(
    checkpoint: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<PullResponse | ResetRequired> {
    const frame = await this.request('pull', { checkpoint, limit }, signal);
    return frame as unknown as PullResponse | ResetRequired;
  }

  async snapshot(
    signal: AbortSignal,
    reset?: ResetRequired,
  ): Promise<SnapshotResponse> {
    if (this.options.fallback) {
      // Snapshots can be large; the HTTP fallback (CDN-cacheable, resumable)
      // is preferred whenever the caller supplies one.
      return this.options.fallback.snapshot(signal, reset);
    }
    const frame = await this.request('snapshot', {}, signal);
    return frame as unknown as SnapshotResponse;
  }

  /** Closes the socket and rejects all in-flight requests. */
  dispose(): void {
    this.disposed = true;
    this.failAllPending(new SyncTransportError('transport disposed', false));
    this.socket?.close(1000, 'dispose');
    this.socket = undefined;
  }

  private async request(
    type: 'push' | 'pull' | 'snapshot',
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.disposed) {
      throw new SyncTransportError('transport disposed', false);
    }
    let socket: WebSocketLike;
    try {
      socket = await this.connect();
    } catch (error) {
      if (this.options.fallback) {
        return this.viaFallback(type, body, signal);
      }
      throw error;
    }

    const requestId = `${this.seed}-${++this.nextRequestId}`;
    const timeoutMs = this.options.requestTimeoutMs ?? 20_000;
    const setTimeoutFn = this.options.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = this.options.clearTimeoutFn ?? clearTimeout;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const abortListener = () => {
        settle();
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      const settle = () => {
        const entry = this.pending.get(requestId);
        if (entry) clearTimeoutFn(entry.timer);
        this.pending.delete(requestId);
        signal.removeEventListener('abort', abortListener);
      };
      if (signal.aborted) {
        abortListener();
        return;
      }
      signal.addEventListener('abort', abortListener, { once: true });
      const timer = setTimeoutFn(() => {
        settle();
        reject(
          new SyncTransportError(`websocket ${type} timed out`, true, undefined, 'WS_TIMEOUT'),
        );
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (frame) => {
          settle();
          resolve(frame);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
        timer,
      });
      try {
        socket.send(JSON.stringify({ v: 1, type, requestId, ...body }));
      } catch (error) {
        const entry = this.pending.get(requestId);
        entry?.reject(
          new SyncTransportError(
            error instanceof Error ? error.message : 'websocket send failed',
            true,
            undefined,
            'WS_SEND_FAILED',
          ),
        );
      }
    });
  }

  private async viaFallback(
    type: 'push' | 'pull' | 'snapshot',
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const fallback = this.options.fallback!;
    if (type === 'push') {
      return (await fallback.push(
        body as unknown as PushRequest,
        signal,
      )) as unknown as Record<string, unknown>;
    }
    if (type === 'pull') {
      return (await fallback.pull(
        String(body.checkpoint),
        Number(body.limit),
        signal,
      )) as unknown as Record<string, unknown>;
    }
    return (await fallback.snapshot(signal)) as unknown as Record<string, unknown>;
  }

  private async connect(): Promise<WebSocketLike> {
    if (this.socket && this.socket.readyState === OPEN) return this.socket;
    if (!this.connecting) {
      this.connecting = this.dial().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private async dial(): Promise<WebSocketLike> {
    const token = await this.options.auth?.getToken();
    let url = this.options.url;
    if (token) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}token=${encodeURIComponent(token)}`;
    }
    const factory =
      this.options.webSocketFactory ??
      ((target: string) => {
        const Ctor = (globalThis as Record<string, unknown>).WebSocket as
          | (new (url: string) => WebSocketLike)
          | undefined;
        if (!Ctor) {
          throw new SyncTransportError(
            'no WebSocket implementation available; pass webSocketFactory',
            false,
            undefined,
            'WS_UNAVAILABLE',
          );
        }
        return new Ctor(target);
      });

    return new Promise<WebSocketLike>((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = factory(url);
      } catch (error) {
        reject(this.dialFailure(error));
        return;
      }
      let settled = false;
      socket.addEventListener('open', () => {
        settled = true;
        this.consecutiveDialFailures = 0;
        this.socket = socket;
        resolve(socket);
      });
      socket.addEventListener('message', (event: { data: unknown }) => {
        this.onFrame(event.data);
      });
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.socket = undefined;
        this.failAllPending(
          new SyncTransportError('websocket closed', true, undefined, 'WS_CLOSED'),
        );
        if (!settled) {
          settled = true;
          reject(this.dialFailure(new Error('websocket closed during dial')));
        }
      });
      socket.addEventListener('error', () => {
        // `close` follows and carries the terminal decision; some
        // implementations only fire `error` for pre-open failures.
        if (!settled && socket.readyState !== OPEN) {
          settled = true;
          reject(this.dialFailure(new Error('websocket connection failed')));
        }
      });
    });
  }

  private dialFailure(error: unknown): SyncTransportError {
    this.consecutiveDialFailures += 1;
    const retryAfterMs = computeRetryDelay(
      Math.min(this.consecutiveDialFailures, 20),
      this.options.reconnectBaseMs ?? 500,
      this.options.reconnectMaxMs ?? 30_000,
      this.options.random ?? Math.random,
    );
    return new SyncTransportError(
      error instanceof Error ? error.message : 'websocket dial failed',
      true,
      retryAfterMs,
      'WS_DIAL_FAILED',
    );
  }

  private failAllPending(error: SyncTransportError): void {
    for (const entry of [...this.pending.values()]) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return; // a malformed broadcast must not kill the connection
    }
    if (frame === null || typeof frame !== 'object' || frame.v !== 1) return;

    if (frame.type === 'changed') {
      if (typeof frame.watermark === 'number') {
        try {
          this.options.onChanged?.(frame.watermark);
        } catch {
          // hints are best-effort; a listener error must not break the socket
        }
      }
      return;
    }

    const requestId = frame.requestId;
    if (typeof requestId !== 'string') return;
    const entry = this.pending.get(requestId);
    if (!entry) return;

    if (frame.type === 'error') {
      entry.reject(frameError(frame));
      return;
    }
    if (
      frame.type === 'push-result' ||
      frame.type === 'pull-result' ||
      frame.type === 'snapshot-result'
    ) {
      const { v: _v, type: _t, requestId: _r, ...body } = frame;
      entry.resolve(body);
    }
  }
}
