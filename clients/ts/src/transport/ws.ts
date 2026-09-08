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
  /** Reject a dial or in-flight request after this long. Default 20s. */
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

/** Host of `url` when its scheme is cleartext `ws://` or `http://`, else null. */
function cleartextHost(url: string): string | null {
  const match = /^(ws|http):\/\//i.exec(url);
  if (!match) return null;
  const authority = url.slice(match[0].length).split(/[/?#]/, 1)[0] ?? '';
  const hostPort = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  if (hostPort.startsWith('[')) {
    return hostPort.slice(1, hostPort.indexOf(']')).toLowerCase();
  }
  const colon = hostPort.indexOf(':');
  return (colon === -1 ? hostPort : hostPort.slice(0, colon)).toLowerCase();
}

/** Loopback, private/link-local IPs, and in-cluster names. */
function internalHostAllowed(host: string): boolean {
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return (
    !host.includes('.') ||
    host.endsWith('.svc.cluster.local') ||
    host.endsWith('.internal')
  );
}

/**
 * Refuse to dial a public host over cleartext while carrying a token.
 *
 * The token travels in the query string (see `AuthTokenProvider`), so over
 * `ws://` it is readable by anyone on the path — and unlike a header it is also
 * the kind of value that ends up in proxy and server access logs. An
 * origin-relative URL inherits the page's scheme and is left alone.
 */
function requireEncryptedTransport(url: string): void {
  const host = cleartextHost(url);
  if (host !== null && !internalHostAllowed(host)) {
    throw new Error(
      `opto-sync: refusing to send a session token over cleartext to public host "${host}": ` +
        'use wss:// (or https://), an in-cluster address, or loopback',
    );
  }
}

type RequestType = 'push' | 'pull' | 'snapshot';
type ResultFrameType = 'push-result' | 'pull-result' | 'snapshot-result';

const RESULT_FRAME_BY_REQUEST: Readonly<Record<RequestType, ResultFrameType>> = {
  push: 'push-result',
  pull: 'pull-result',
  snapshot: 'snapshot-result',
};

interface PendingRequest {
  generation: number;
  expectedType: ResultFrameType;
  resolve: (frame: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnectedSocket {
  socket: WebSocketLike;
  generation: number;
}

interface ConnectingAttempt {
  generation: number;
  promise: Promise<ConnectedSocket>;
  cancel: (error: SyncTransportError) => void;
}

const OPEN = 1;
const CLOSED = 3;
const MAX_INBOUND_FRAME_BYTES = 1024 * 1024;

function textByteLength(value: string): number {
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).byteLength
    : value.length;
}

function frameError(frame: Record<string, unknown>): SyncTransportError {
  return new SyncTransportError(
    typeof frame.message === 'string' ? frame.message : 'sync websocket error',
    frame.retryable !== false,
    undefined,
    typeof frame.code === 'string' ? frame.code : 'WS_ERROR',
  );
}

export class WebSocketTransport implements ProtocolTransport {
  private socket: ConnectedSocket | undefined;
  private connecting: ConnectingAttempt | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 0;
  private socketGeneration = 0;
  private consecutiveDialFailures = 0;
  private disposed = false;
  private readonly seed = Math.random().toString(36).slice(2, 10);

  constructor(private readonly options: WebSocketTransportOptions) {
    if (!options.url) throw new RangeError('WebSocketTransport requires a url');
    const timeoutMs = options.requestTimeoutMs ?? 20_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('requestTimeoutMs must be a positive finite number');
    }
  }

  async push(request: PushRequest, signal: AbortSignal): Promise<PushResponse> {
    const frame = await this.request(
      'push',
      request as unknown as Record<string, unknown>,
      signal,
    );
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

  /** Closes the socket and rejects all in-flight and dialing requests. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.socketGeneration += 1;
    const error = new SyncTransportError('transport disposed', false);
    const attempt = this.connecting;
    this.connecting = undefined;
    attempt?.cancel(error);
    this.failPending(error);
    const active = this.socket;
    this.socket = undefined;
    if (active) this.closeSocket(active.socket, 1000, 'dispose');
  }

  private async request(
    type: RequestType,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.disposed) {
      throw new SyncTransportError('transport disposed', false);
    }
    let connection: ConnectedSocket;
    try {
      connection = await this.connect();
    } catch (error) {
      if (!this.disposed && this.options.fallback) {
        return this.viaFallback(type, body, signal);
      }
      throw error;
    }

    if (!this.isCurrentConnection(connection)) {
      throw new SyncTransportError(
        'websocket closed before request send',
        true,
        undefined,
        'WS_CLOSED',
      );
    }

    const { socket, generation } = connection;
    const requestId = `${this.seed}-${++this.nextRequestId}`;
    const timeoutMs = this.timeoutMs();
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
      if (!this.isCurrentConnection(connection)) {
        reject(
          new SyncTransportError(
            'websocket closed before request send',
            true,
            undefined,
            'WS_CLOSED',
          ),
        );
        return;
      }
      signal.addEventListener('abort', abortListener, { once: true });
      const timer = setTimeoutFn(() => {
        settle();
        reject(
          new SyncTransportError(
            `websocket ${type} timed out`,
            true,
            undefined,
            'WS_TIMEOUT',
          ),
        );
      }, timeoutMs);
      this.pending.set(requestId, {
        generation,
        expectedType: RESULT_FRAME_BY_REQUEST[type],
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
      } catch {
        const entry = this.pending.get(requestId);
        entry?.reject(
          new SyncTransportError(
            'websocket send failed',
            true,
            undefined,
            'WS_SEND_FAILED',
          ),
        );
      }
    });
  }

  private async viaFallback(
    type: RequestType,
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
    return (await fallback.snapshot(signal)) as unknown as Record<
      string,
      unknown
    >;
  }

  private async connect(): Promise<ConnectedSocket> {
    if (this.disposed) {
      throw new SyncTransportError('transport disposed', false);
    }
    if (this.socket && this.socket.socket.readyState === OPEN) {
      return this.socket;
    }
    if (!this.connecting) {
      const attempt = this.beginDial();
      this.connecting = attempt;
      void attempt.promise.then(
        () => {
          if (this.connecting === attempt) this.connecting = undefined;
        },
        () => {
          if (this.connecting === attempt) this.connecting = undefined;
        },
      );
    }
    return this.connecting.promise;
  }

  private beginDial(): ConnectingAttempt {
    const generation = ++this.socketGeneration;
    let cancel!: (error: SyncTransportError) => void;
    const cancellation = new Promise<ConnectedSocket>((_resolve, reject) => {
      cancel = reject;
    });
    const promise = Promise.race([
      this.dial(generation),
      cancellation,
    ]);
    return { generation, promise, cancel };
  }

  private async dial(generation: number): Promise<ConnectedSocket> {
    let token: string | null | undefined;
    try {
      token = await this.options.auth?.getToken();
    } catch {
      throw this.dialFailure(
        'websocket authentication token lookup failed',
        'WS_AUTH_FAILED',
      );
    }
    if (this.disposed || generation !== this.socketGeneration) {
      throw new SyncTransportError('websocket dial superseded', false);
    }

    let url = this.options.url;
    if (token) {
      requireEncryptedTransport(url);
      if (url.includes('#')) {
        throw new SyncTransportError(
          'websocket URL must not contain a fragment when authentication is enabled',
          false,
          undefined,
          'WS_INVALID_URL',
        );
      }
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

    return new Promise<ConnectedSocket>((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = factory(url);
      } catch {
        reject(this.dialFailure('websocket constructor failed'));
        return;
      }

      let opened = false;
      let dialSettled = false;
      const setTimeoutFn = this.options.setTimeoutFn ?? setTimeout;
      const clearTimeoutFn = this.options.clearTimeoutFn ?? clearTimeout;
      const timeout = setTimeoutFn(() => {
        if (dialSettled) return;
        dialSettled = true;
        this.closeSocket(socket, 1001, 'dial timeout');
        reject(this.dialFailure('websocket dial timed out', 'WS_DIAL_TIMEOUT'));
      }, this.timeoutMs());
      (
        timeout as ReturnType<typeof setTimeout> & { unref?: () => void }
      ).unref?.();

      const clearDialTimeout = () => clearTimeoutFn(timeout);
      const onOpen = () => {
        if (dialSettled) return;
        if (this.disposed || generation !== this.socketGeneration) {
          dialSettled = true;
          clearDialTimeout();
          this.closeSocket(socket, 1000, 'superseded dial');
          reject(new SyncTransportError('websocket dial superseded', false));
          return;
        }
        opened = true;
        dialSettled = true;
        clearDialTimeout();
        this.consecutiveDialFailures = 0;
        const connection = { socket, generation };
        this.socket = connection;
        resolve(connection);
      };
      const onMessage = (event: { data: unknown }) => {
        this.onFrame(event.data, socket, generation);
      };
      const onClose = () => {
        const generationCurrent = generation === this.socketGeneration;
        const active = this.isActiveSocket(socket, generation);
        if (active) {
          this.socket = undefined;
          this.failPending(
            new SyncTransportError(
              'websocket closed',
              true,
              undefined,
              'WS_CLOSED',
            ),
            generation,
          );
        }
        if (!opened && !dialSettled && generationCurrent) {
          dialSettled = true;
          clearDialTimeout();
          reject(
            this.dialFailure(
              'websocket closed during dial',
              'WS_DIAL_FAILED',
            ),
          );
        }
      };
      const onError = () => {
        if (generation !== this.socketGeneration) return;
        if (!opened && !dialSettled) {
          dialSettled = true;
          clearDialTimeout();
          this.closeSocket(socket, 1011, 'connection failed');
          reject(
            this.dialFailure(
              'websocket connection failed',
              'WS_DIAL_FAILED',
            ),
          );
          return;
        }
        if (this.isActiveSocket(socket, generation)) {
          this.failConnection(
            socket,
            generation,
            new SyncTransportError(
              'websocket connection error',
              true,
              undefined,
              'WS_SOCKET_ERROR',
            ),
            1011,
            'connection error',
          );
        }
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onError);
    });
  }

  private dialFailure(
    message: string,
    code = 'WS_DIAL_FAILED',
  ): SyncTransportError {
    this.consecutiveDialFailures += 1;
    const retryAfterMs = computeRetryDelay(
      Math.min(this.consecutiveDialFailures, 20),
      this.options.reconnectBaseMs ?? 500,
      this.options.reconnectMaxMs ?? 30_000,
      this.options.random ?? Math.random,
    );
    return new SyncTransportError(
      message,
      true,
      retryAfterMs,
      code,
    );
  }

  private timeoutMs(): number {
    return this.options.requestTimeoutMs ?? 20_000;
  }

  private failPending(error: SyncTransportError, generation?: number): void {
    for (const entry of [...this.pending.values()]) {
      if (generation === undefined || entry.generation === generation) {
        entry.reject(error);
      }
    }
  }

  private isCurrentConnection(connection: ConnectedSocket): boolean {
    return (
      !this.disposed &&
      connection.generation === this.socketGeneration &&
      this.socket === connection &&
      connection.socket.readyState === OPEN
    );
  }

  private isActiveSocket(socket: WebSocketLike, generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.socketGeneration &&
      this.socket?.generation === generation &&
      this.socket.socket === socket &&
      socket.readyState === OPEN
    );
  }

  private failConnection(
    socket: WebSocketLike,
    generation: number,
    error: SyncTransportError,
    closeCode: number,
    closeReason: string,
  ): void {
    if (!this.isActiveSocket(socket, generation)) return;
    this.socket = undefined;
    this.failPending(error, generation);
    this.closeSocket(socket, closeCode, closeReason);
  }

  private closeSocket(
    socket: WebSocketLike,
    code: number,
    reason: string,
  ): void {
    if (socket.readyState === CLOSED) return;
    try {
      socket.close(code, reason);
    } catch {
      // Generation fencing is the source of truth even if provider close fails.
    }
  }

  private onFrame(
    data: unknown,
    socket: WebSocketLike,
    generation: number,
  ): void {
    if (!this.isActiveSocket(socket, generation)) return;
    if (typeof data !== 'string') {
      this.failConnection(
        socket,
        generation,
        new SyncTransportError(
          'websocket protocol requires text frames',
          false,
          undefined,
          'WS_BINARY_FRAME',
        ),
        1003,
        'text frames required',
      );
      return;
    }
    if (textByteLength(data) > MAX_INBOUND_FRAME_BYTES) {
      this.failConnection(
        socket,
        generation,
        new SyncTransportError(
          'websocket frame exceeds the protocol limit',
          false,
          undefined,
          'WS_FRAME_TOO_LARGE',
        ),
        1009,
        'frame too large',
      );
      return;
    }

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return; // a malformed broadcast must not kill the connection
    }
    if (
      frame === null ||
      typeof frame !== 'object' ||
      Array.isArray(frame) ||
      frame.v !== 1
    ) {
      return;
    }

    if (frame.type === 'changed') {
      if (
        typeof frame.watermark === 'number' &&
        Number.isSafeInteger(frame.watermark) &&
        frame.watermark >= 0
      ) {
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
    if (!entry || entry.generation !== generation) return;

    if (frame.type === 'error') {
      entry.reject(frameError(frame));
      return;
    }
    if (frame.type !== entry.expectedType) {
      if (
        frame.type === 'push-result' ||
        frame.type === 'pull-result' ||
        frame.type === 'snapshot-result'
      ) {
        this.failConnection(
          socket,
          generation,
          new SyncTransportError(
            `websocket response type ${String(frame.type)} does not match ${entry.expectedType}`,
            false,
            undefined,
            'WS_PROTOCOL_MISMATCH',
          ),
          1002,
          'response type mismatch',
        );
      }
      return;
    }

    const { v: _v, type: _t, requestId: _r, ...body } = frame;
    entry.resolve(body);
  }
}
