import type {
  ProtocolTransport,
  ResetRequired,
} from '@opto-sync/client';
import type {
  PullResponse,
  PushRequest,
  PushResponse,
  SnapshotResponse,
} from '@opto-sync/client';

export class HttpSyncError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpSyncError';
  }
}

export interface HttpProtocolTransportOptions {
  baseUrl: string;
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof globalThis.fetch;
  pushPath?: string;
  pullPath?: string;
  snapshotPath?: string;
  credentials?: RequestCredentials;
  /** Refuse a RESET_REQUIRED snapshot URL on another origin. Default true. */
  sameOriginSnapshots?: boolean;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function path(value: string | undefined, fallback: string): string {
  const result = value ?? fallback;
  if (!result.startsWith('/')) throw new Error(`sync endpoint must start with /: ${result}`);
  return result;
}

/** HTTP remains authoritative; WebSocket/Supabase/TCP messages only call hint(). */
export class HttpProtocolTransport implements ProtocolTransport {
  private readonly base: URL;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly pushPath: string;
  private readonly pullPath: string;
  private readonly snapshotPath: string;
  private readonly credentials: RequestCredentials;
  private readonly sameOriginSnapshots: boolean;

  constructor(private readonly options: HttpProtocolTransportOptions) {
    this.base = new URL(options.baseUrl);
    if (this.base.protocol !== 'https:' && this.base.hostname !== '127.0.0.1' && this.base.hostname !== 'localhost') {
      throw new Error('opto-sync HTTP transport requires HTTPS outside loopback');
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error('fetch is unavailable');
    this.pushPath = path(options.pushPath, '/sync/v1/push');
    this.pullPath = path(options.pullPath, '/sync/v1/pull');
    this.snapshotPath = path(options.snapshotPath, '/sync/v1/snapshot');
    this.credentials = options.credentials ?? 'same-origin';
    this.sameOriginSnapshots = options.sameOriginSnapshots !== false;
  }

  async push(request: PushRequest, signal: AbortSignal): Promise<PushResponse> {
    return this.requestJson<PushResponse>(new URL(this.pushPath, this.base), {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    });
  }

  async pull(
    checkpoint: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<PullResponse | ResetRequired> {
    const url = new URL(this.pullPath, this.base);
    url.searchParams.set('checkpoint', checkpoint);
    url.searchParams.set('limit', String(limit));
    return this.requestJson<PullResponse | ResetRequired>(url, { method: 'GET', signal });
  }

  async snapshot(
    signal: AbortSignal,
    reset?: ResetRequired,
  ): Promise<SnapshotResponse> {
    const url = reset?.snapshotUrl
      ? new URL(reset.snapshotUrl, this.base)
      : new URL(this.snapshotPath, this.base);
    if (this.sameOriginSnapshots && url.origin !== this.base.origin) {
      throw new HttpSyncError('cross-origin snapshot URL refused', 0, false);
    }
    return this.requestJson<SnapshotResponse>(url, { method: 'GET', signal });
  }

  private async requestJson<T>(
    url: URL,
    init: RequestInit,
  ): Promise<T> {
    const headers = await this.options.headers?.();
    const response = await this.fetchImpl(url, {
      ...init,
      credentials: this.credentials,
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      throw new HttpSyncError(
        `opto-sync HTTP ${response.status}: ${body || response.statusText}`,
        response.status,
        retryable,
        retryAfterMs(response.headers.get('retry-after')),
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new HttpSyncError('opto-sync endpoint returned non-JSON content', response.status, false);
    }
    return (await response.json()) as T;
  }
}
