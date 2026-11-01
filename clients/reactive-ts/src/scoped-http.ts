import type { ScopedCollection, ScopedPullPageV1, ScopedSnapshotV1 } from './scoped-collection.ts';

/**
 * HTTP is the authoritative scoped read source. WebSockets/Supabase remain
 * wake hints and cannot advance a checkpoint or acknowledge a mutation.
 */
export interface ScopedHttpOptions {
  readonly baseUrl: string;
  /** Read current credentials at request time; never persist bearer tokens. */
  readonly headers: () => Record<string, string> | Promise<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxPages?: number;
}

export type ScopedSyncOutcome =
  | { readonly status: 'caught-up'; readonly checkpoint: string }
  | { readonly status: 'more'; readonly checkpoint: string }
  | { readonly status: 'reset-required' };

export class ScopedHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super('scoped sync failed: ' + code);
    this.name = 'ScopedHttpError';
    this.status = status;
    this.code = code;
  }
}

function boundedCode(raw: unknown): string {
  return typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(raw)
    ? raw
    : 'REMOTE_ERROR';
}

async function postJson(
  endpoint: string,
  body: object,
  options: ScopedHttpOptions,
): Promise<{ status: number; value: unknown }> {
  const http = options.fetchImpl ?? fetch;
  const headers = await options.headers();
  const response = await http(new URL(endpoint, options.baseUrl), {
    method: 'POST',
    cache: 'no-store',
    redirect: 'error',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  // Bounded even if Content-Length is untrustworthy.
  const maxBytes = 16 * 1024 * 1024;
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw new ScopedHttpError(response.status, 'RESPONSE_TOO_LARGE');
  }
  // Read as text to enforce a hard application-level size bound before parsing.
  const raw = await response.text();
  if (raw.length > maxBytes) throw new ScopedHttpError(response.status, 'RESPONSE_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ScopedHttpError(response.status, 'INVALID_RESPONSE'); }
  return { status: response.status, value };
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ScopedHttpError(502, 'INVALID_RESPONSE');
  }
  return value as Record<string, unknown>;
}

/** One bounded HTTP snapshot + pull cycle. The caller owns scheduling and hints. */
export async function syncScopedCollectionOnce<T>(
  collection: ScopedCollection<T>,
  options: ScopedHttpOptions,
): Promise<ScopedSyncOutcome> {
  const pages = options.maxPages ?? 32;
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 1000) {
    throw new RangeError('maxPages must be 1..1000');
  }
  if (!collection.getView().ready) {
    const snapshot = await postJson('/v1/sync/scopes/snapshot', {
      protocolVersion: 1,
      scope: collection.scope,
      scopeKey: collection.scopeKey,
    }, options);
    const value = bodyObject(snapshot.value);
    if (snapshot.status !== 200) {
      throw new ScopedHttpError(snapshot.status, boundedCode(value.error));
    }
    await collection.installSnapshot(value as unknown as ScopedSnapshotV1<T>);
  }
  for (let pageNumber = 0; pageNumber < pages; pageNumber++) {
    const checkpoint = collection.getView().checkpoint;
    const scopeToken = collection.getScopeToken();
    if (checkpoint === null || scopeToken === null) {
      throw new Error('scoped snapshot is missing');
    }
    const result = await postJson('/v1/sync/scopes/pull', {
      protocolVersion: 1,
      scope: collection.scope,
      scopeKey: collection.scopeKey,
      scopeToken,
      checkpoint,
      limit: 100,
    }, options);
    const value = bodyObject(result.value);
    if (result.status === 409 && value.error === 'RESET_REQUIRED') {
      await collection.requireSnapshot();
      return { status: 'reset-required' };
    }
    if (result.status !== 200) {
      throw new ScopedHttpError(result.status, boundedCode(value.error));
    }
    if (typeof value.hasMore !== 'boolean') {
      throw new ScopedHttpError(502, 'INVALID_RESPONSE');
    }
    await collection.applyPullPage(value as unknown as ScopedPullPageV1<T>);
    if (!value.hasMore) {
      return { status: 'caught-up', checkpoint: collection.getView().checkpoint! };
    }
  }
  return { status: 'more', checkpoint: collection.getView().checkpoint! };
}
