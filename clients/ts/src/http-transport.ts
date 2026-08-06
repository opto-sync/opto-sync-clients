import type {
  PullResponse,
  PushRequest,
  PushResponse,
  SnapshotResponse,
} from './protocol.js';
import type {
  ProtocolTransport,
  ResetRequired,
} from './sync-loop.js';
import { SyncTransportError } from './sync-loop.js';

export type ProtocolHeaders =
  | HeadersInit
  | (() => HeadersInit | Promise<HeadersInit>);

export interface FetchProtocolTransportOptions {
  /**
   * Optional origin/base path. With `baseUrl: "/api/sync/"`, the default
   * endpoints resolve to `/api/sync/push`, `/api/sync/pull`, and
   * `/api/sync/snapshot`.
   */
  baseUrl?: string;
  pushPath?: string;
  pullPath?: string;
  snapshotPath?: string;
  headers?: ProtocolHeaders;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
}

function endpoint(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedBase)) {
    return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
  }
  return `${normalizedBase}${path.replace(/^\/+/, '')}`;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new SyncTransportError(
      `sync endpoint returned HTTP ${response.status}`,
      retryableStatus(response.status),
      retryAfterMs(response),
      `HTTP_${response.status}`,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new SyncTransportError(
      'sync endpoint returned invalid JSON',
      false,
      undefined,
      'INVALID_JSON_RESPONSE',
    );
  }
}

/**
 * Fetch-based protocol v1 transport.
 *
 * It runs unchanged in a browser tab, service worker, Deno/Bun, or modern
 * Node. Authentication stays application-owned through the lazy `headers`
 * callback, so a short-lived token is resolved for every request rather than
 * captured when the worker starts.
 */
export class FetchProtocolTransport implements ProtocolTransport {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly pushUrl: string;
  private readonly pullUrl: string;
  private readonly snapshotUrl: string;

  constructor(private readonly options: FetchProtocolTransportOptions = {}) {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') {
      throw new TypeError('FetchProtocolTransport requires a fetch implementation');
    }
    this.fetcher = fetcher.bind(globalThis);
    this.pushUrl = endpoint(options.baseUrl, options.pushPath ?? 'push');
    this.pullUrl = endpoint(options.baseUrl, options.pullPath ?? 'pull');
    this.snapshotUrl = endpoint(
      options.baseUrl,
      options.snapshotPath ?? 'snapshot',
    );
  }

  async push(
    request: PushRequest,
    signal: AbortSignal,
  ): Promise<PushResponse> {
    return this.request<PushResponse>(this.pushUrl, {
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
    const url = new URL(this.pullUrl, globalThis.location?.href ?? 'http://localhost/');
    url.searchParams.set('checkpoint', checkpoint);
    url.searchParams.set('limit', String(limit));
    return this.request<PullResponse | ResetRequired>(
      /^[a-z][a-z\d+.-]*:/i.test(this.pullUrl)
        ? url.toString()
        : `${url.pathname}${url.search}`,
      { method: 'GET', signal },
    );
  }

  async snapshot(
    signal: AbortSignal,
    reset?: ResetRequired,
  ): Promise<SnapshotResponse> {
    const url = reset?.snapshotUrl
      ? endpoint(this.options.baseUrl, reset.snapshotUrl)
      : this.snapshotUrl;
    return this.request<SnapshotResponse>(url, { method: 'GET', signal });
  }

  private async request<T>(
    url: string,
    init: RequestInit,
  ): Promise<T> {
    const configured =
      typeof this.options.headers === 'function'
        ? await this.options.headers()
        : this.options.headers;
    const headers = new Headers(configured);
    headers.set('accept', 'application/json');
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers,
        credentials: this.options.credentials,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new SyncTransportError(
        error instanceof Error ? error.message : 'network request failed',
        true,
        undefined,
        'NETWORK_ERROR',
      );
    }
    return responseJson<T>(response);
  }
}
