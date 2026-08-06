import {
  Observable,
  ReplaySubject,
  distinctUntilChanged,
  share,
  switchMap,
  from,
  type Subscription,
} from 'rxjs';
import { SyncTransportError } from './sync-loop.js';

export type SyncSessionStatus =
  | 'authenticated'
  | 'anonymous'
  | 'degraded';

export interface SyncSessionSnapshot {
  status: SyncSessionStatus;
  /**
   * Stable, non-secret storage scope. It separates users/sessions but is not an
   * authorization decision and must never be used as a server-side tenant.
   */
  scope: string;
  authority?: 'supabase' | 'shared-auth' | (string & {});
  accessToken?: string;
  expiresAt?: number;
  reason?: string;
}

export interface SyncSessionProvider {
  current(): Promise<SyncSessionSnapshot>;
  readonly changes$: Observable<SyncSessionSnapshot>;
}

export class SyncSessionError extends SyncTransportError {
  constructor(
    message: string,
    retryable: boolean,
    code:
      | 'ANONYMOUS_SESSION'
      | 'SESSION_AUTHORITY_UNAVAILABLE'
      | 'SESSION_TOKEN_MISSING',
  ) {
    super(message, retryable, undefined, code);
    this.name = 'SyncSessionError';
  }
}

function snapshotKey(session: SyncSessionSnapshot): string {
  return [
    session.status,
    session.scope,
    session.authority ?? '',
    session.expiresAt ?? '',
    // Do not put token bytes into Rx diagnostics or equality keys.
    session.accessToken ? 'token' : 'no-token',
  ].join('\u0000');
}

/** Lazy headers callback for `FetchProtocolTransport`. */
export function sessionAuthorizationHeaders(
  provider: SyncSessionProvider,
  base?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>),
): () => Promise<Headers> {
  return async () => {
    const session = await provider.current();
    if (session.status === 'anonymous') {
      throw new SyncSessionError(
        'sync requires an authenticated session',
        false,
        'ANONYMOUS_SESSION',
      );
    }
    if (session.status === 'degraded') {
      throw new SyncSessionError(
        'session authority is temporarily unavailable',
        true,
        'SESSION_AUTHORITY_UNAVAILABLE',
      );
    }
    if (!session.accessToken) {
      throw new SyncSessionError(
        'authenticated session has no access token',
        false,
        'SESSION_TOKEN_MISSING',
      );
    }
    const configured = typeof base === 'function' ? await base() : base;
    const headers = new Headers(configured);
    headers.set('authorization', `Bearer ${session.accessToken}`);
    return headers;
  };
}

/**
 * Stable per-session IndexedDB name.
 *
 * Only a hash of the verified provider scope is exposed in the database list;
 * access/refresh tokens are never persisted by opto-sync or used in the name.
 */
export async function sessionDatabaseName(
  baseName: string,
  session: Pick<SyncSessionSnapshot, 'scope' | 'authority'>,
): Promise<string> {
  if (!baseName || !session.scope) {
    throw new TypeError('baseName and session scope are required');
  }
  const bytes = new TextEncoder().encode(
    `${session.authority ?? 'session'}\u0000${session.scope}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const suffix = Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${baseName}-${suffix}`;
}

interface SupabaseUserLike {
  id: string;
}

interface SupabaseSessionLike {
  access_token: string;
  expires_at?: number;
  user: SupabaseUserLike;
}

interface SupabaseAuthSubscriptionLike {
  unsubscribe(): void;
}

export interface SupabaseAuthLike {
  getSession(): Promise<{
    data: { session: SupabaseSessionLike | null };
    error?: unknown;
  }>;
  onAuthStateChange(
    callback: (event: string, session: SupabaseSessionLike | null) => void,
  ): {
    data: { subscription: SupabaseAuthSubscriptionLike };
  };
}

function jwtSessionId(accessToken: string): string | undefined {
  try {
    const encoded = accessToken.split('.')[1];
    if (!encoded) return undefined;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const json = atob(padded);
    const bytes = Uint8Array.from(json, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      session_id?: unknown;
    };
    return typeof payload.session_id === 'string'
      ? payload.session_id
      : undefined;
  } catch {
    return undefined;
  }
}

function supabaseSnapshot(
  session: SupabaseSessionLike | null,
): SyncSessionSnapshot {
  if (!session) return { status: 'anonymous', scope: 'anonymous' };
  // JWT decoding is used only to choose a local storage namespace. The server
  // still verifies the token and derives tenant/roles from verified claims.
  const sessionId = jwtSessionId(session.access_token);
  return {
    status: 'authenticated',
    scope: sessionId
      ? `${session.user.id}:${sessionId}`
      : session.user.id,
    authority: 'supabase',
    accessToken: session.access_token,
    expiresAt: session.expires_at,
  };
}

/**
 * Supabase session adapter with synchronous auth-event handling.
 *
 * `onAuthStateChange` only emits the provided snapshot; it never calls another
 * Supabase method from inside the callback, avoiding the current auth-client
 * callback deadlock. Fresh token lookup happens later in `current()`.
 */
export function createSupabaseSessionProvider(
  auth: SupabaseAuthLike,
): SyncSessionProvider {
  const rawChanges$ = new Observable<SyncSessionSnapshot>((subscriber) => {
    const {
      data: { subscription },
    } = auth.onAuthStateChange((_event, session) => {
      subscriber.next(supabaseSnapshot(session));
    });
    return () => subscription.unsubscribe();
  });
  const changes$ = rawChanges$.pipe(
    distinctUntilChanged(
      (left, right) => snapshotKey(left) === snapshotKey(right),
    ),
    share({
      connector: () => new ReplaySubject<SyncSessionSnapshot>(1),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    }),
  );
  return {
    async current() {
      const { data, error } = await auth.getSession();
      if (error) {
        return {
          status: 'degraded',
          scope: 'unresolved',
          authority: 'supabase',
          reason: error instanceof Error ? error.message : 'session unavailable',
        };
      }
      return supabaseSnapshot(data.session);
    },
    changes$,
  };
}

export interface SharedAuthIdentityLike {
  shared_user_id: string;
  provider_tenant: string;
  session_id?: string | null;
  authority: 'shared-auth' | 'supabase';
}

export type SharedAuthOutcomeLike =
  | {
      status: 'authenticated';
      identity: SharedAuthIdentityLike;
    }
  | { status: 'anonymous' | 'unauthenticated' }
  | { status: 'degraded'; reason: string };

export interface SharedAuthTokenStoreLike {
  read():
    | { accessToken: string }
    | undefined
    | Promise<{ accessToken: string } | undefined>;
}

function sharedAuthSnapshot(
  outcome: SharedAuthOutcomeLike,
  accessToken?: string,
): SyncSessionSnapshot {
  if (outcome.status === 'degraded') {
    return {
      status: 'degraded',
      scope: 'unresolved',
      authority: 'shared-auth',
      reason: outcome.reason,
    };
  }
  if (outcome.status !== 'authenticated') {
    return { status: 'anonymous', scope: 'anonymous' };
  }
  const identity = outcome.identity;
  return {
    status: 'authenticated',
    scope: [
      identity.shared_user_id,
      identity.provider_tenant,
      identity.session_id ?? 'sessionless',
    ].join(':'),
    authority: identity.authority,
    accessToken,
  };
}

/**
 * Structural adapter for `@shared-auth/client` and generated shared-auth
 * identity types. This avoids forcing either repository to vendor the other.
 */
export function createSharedAuthSessionProvider(options: {
  currentOutcome(): Promise<SharedAuthOutcomeLike>;
  outcomes$: Observable<SharedAuthOutcomeLike>;
  tokenStore: SharedAuthTokenStoreLike;
}): SyncSessionProvider {
  const resolve = async (
    outcome: SharedAuthOutcomeLike,
  ): Promise<SyncSessionSnapshot> => {
    const tokens = await options.tokenStore.read();
    return sharedAuthSnapshot(outcome, tokens?.accessToken);
  };
  const changes$ = options.outcomes$.pipe(
    switchMap((outcome) => from(resolve(outcome))),
    distinctUntilChanged(
      (left, right) => snapshotKey(left) === snapshotKey(right),
    ),
    share({
      connector: () => new ReplaySubject<SyncSessionSnapshot>(1),
      resetOnError: true,
      resetOnComplete: true,
      resetOnRefCountZero: true,
    }),
  );
  return {
    async current() {
      return resolve(await options.currentOutcome());
    },
    changes$,
  };
}

export interface SessionBoundSyncResource {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface SessionBoundSyncManagerOptions {
  provider: SyncSessionProvider;
  databaseBaseName: string;
  open(
    session: Readonly<SyncSessionSnapshot>,
    databaseName: string,
  ): Promise<SessionBoundSyncResource>;
  onSessionChange?: (session: Readonly<SyncSessionSnapshot>) => void;
  onError?: (error: unknown) => void;
}

/**
 * Switches IndexedDB/loops atomically when the authenticated session changes.
 *
 * A degraded auth authority does not look like logout: the active local
 * resource remains readable while its lazy transport fails retryably. An
 * anonymous session closes the authenticated resource. Token refreshes within
 * the same scope do not reopen IndexedDB.
 */
export class SessionBoundSyncManager {
  private subscription?: Subscription;
  private active?: SessionBoundSyncResource;
  private activeScope?: string;
  private transitions: Promise<void> = Promise.resolve();
  private started = false;

  constructor(private readonly options: SessionBoundSyncManagerOptions) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.subscription = this.options.provider.changes$.subscribe({
      next: (session) => this.enqueue(session),
      error: (error) => this.options.onError?.(error),
    });
    this.enqueue(await this.options.provider.current());
    await this.transitions;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    await this.transitions;
    await this.active?.stop();
    this.active = undefined;
    this.activeScope = undefined;
  }

  private enqueue(session: SyncSessionSnapshot): void {
    this.transitions = this.transitions
      .then(() => this.transition(session))
      .catch((error) => this.options.onError?.(error));
  }

  private async transition(session: SyncSessionSnapshot): Promise<void> {
    if (!this.started) return;
    this.options.onSessionChange?.(session);
    if (session.status === 'degraded') return;
    if (session.status === 'anonymous') {
      await this.active?.stop();
      this.active = undefined;
      this.activeScope = undefined;
      return;
    }
    const scope = `${session.authority ?? 'session'}\u0000${session.scope}`;
    if (scope === this.activeScope) return;
    const databaseName = await sessionDatabaseName(
      this.options.databaseBaseName,
      session,
    );
    const next = await this.options.open(session, databaseName);
    const previous = this.active;
    await next.start();
    this.active = next;
    this.activeScope = scope;
    await previous?.stop();
  }
}
