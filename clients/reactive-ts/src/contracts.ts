export const SYNC_OPTIMISM = Object.freeze({
  remoteConfirmed: 'remote-confirmed',
  localDurable: 'local-durable',
  localThenRemote: 'local-then-remote',
} as const);

export type SyncOptimism =
  (typeof SYNC_OPTIMISM)[keyof typeof SYNC_OPTIMISM];

export type SyncSource =
  | 'local'
  | 'http'
  | 'websocket'
  | 'tcp'
  | 'supabase'
  | 'broadcast'
  | 'service-worker';

/**
 * Structural subset of shared-auth's verified identity contract.
 *
 * The package intentionally does not import the private shared-auth package at
 * runtime. A Supabase session or a generated shared-auth binding can map into
 * this shape without leaking bearer tokens into IndexedDB, BroadcastChannel,
 * logs, or event dedupe keys.
 */
export interface SyncSessionIdentity {
  shared_user_id: string;
  provider: string;
  provider_tenant: string;
  provider_subject: string;
  project?: string | null;
  supabase_user_id?: string | null;
  session_id?: string | null;
  authority?: 'shared-auth' | 'supabase' | string;
  roles?: readonly string[];
}

export type SyncSession =
  | {
      status: 'authenticated';
      identity: SyncSessionIdentity;
    }
  | { status: 'anonymous' }
  | { status: 'unauthenticated' }
  | { status: 'degraded'; reason: string };

/** Stable queue/storage partition. Token refresh and session rotation keep it. */
export function storagePartitionKey(identity: SyncSessionIdentity): string {
  return [identity.provider, identity.provider_tenant, identity.shared_user_id]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

/** Transport generation. A new revocation-aware session cancels stale streams. */
export function transportSessionKey(identity: SyncSessionIdentity): string {
  return `${storagePartitionKey(identity)}:${encodeURIComponent(
    identity.session_id ?? 'sessionless',
  )}`;
}

export function requireAuthenticated(
  session: SyncSession,
): SyncSessionIdentity {
  if (session.status === 'authenticated') return session.identity;
  if (session.status === 'degraded') {
    throw new Error(
      `sync authentication is degraded; privileged synchronization fails closed: ${session.reason}`,
    );
  }
  throw new Error(`sync requires an authenticated session (${session.status})`);
}

export type SyncRecordOperation = 'upsert' | 'delete';
export type SyncRecordAuthority = 'local-view' | 'authoritative';

export interface SyncRecordEvent<T> {
  table: string;
  recordId: string;
  operation: SyncRecordOperation;
  payload: T | null;
  /** Server revision or local mutation identity, represented losslessly. */
  revision: string;
  checkpoint?: string;
  source: SyncSource;
  authority: SyncRecordAuthority;
  /** True while the local projection still includes unacknowledged work. */
  pending?: boolean;
  /** Cross-transport identity. Must not include access/refresh tokens. */
  dedupeKey?: string;
  sessionPartition: string;
}

export interface SyncHint {
  reason:
    | 'local-mutation'
    | 'remote-change'
    | 'connectivity'
    | 'background-wake'
    | 'manual';
  source: SyncSource;
  sessionPartition: string;
  table?: string;
  recordId?: string;
  checkpoint?: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function recordEventDedupeKey<T>(event: SyncRecordEvent<T>): string {
  return (
    event.dedupeKey ??
    [
      event.sessionPartition,
      event.table,
      event.recordId,
      event.operation,
      event.revision,
      stableJson(event.payload),
    ].join('\u0000')
  );
}

export function sameProjectedValue<T>(left: T | null, right: T | null): boolean {
  return stableJson(left) === stableJson(right);
}
