/**
 * UI-agnostic connectivity state for opto-sync clients.
 *
 * Link availability is deliberately distinct from verified internet access:
 * browser `online` events, Android transports, and Apple path satisfaction can
 * all be true behind captive portals or broken upstream routes. Applications
 * that need `internet` state must configure a bounded reachability probe or
 * publish a verified result from a native adapter.
 */

export type ConnectivityState = 'unknown' | 'offline' | 'link' | 'internet';
export type ConnectivityMode = 'automatic' | 'offline';
export type ConnectivitySource =
  | 'initial'
  | 'manual'
  | 'browser-event'
  | 'probe'
  | 'forced-offline';

export interface ConnectivitySnapshot {
  readonly state: ConnectivityState;
  readonly mode: ConnectivityMode;
  readonly source: ConnectivitySource;
  /** Milliseconds since Unix epoch when the exposed state last changed. */
  readonly changedAt: number;
  /** Last successful end-to-end reachability verification, if any. */
  readonly verifiedAt?: number;
}

export type ConnectivityListener = (
  snapshot: ConnectivitySnapshot,
  previous: ConnectivitySnapshot,
) => void | Promise<void>;

export interface ConnectivitySubscribeOptions {
  /** Emit the current snapshot synchronously after subscribing. Default true. */
  emitCurrent?: boolean;
}

export interface ConnectivityWatcher {
  snapshot(): ConnectivitySnapshot;
  subscribe(
    listener: ConnectivityListener,
    options?: ConnectivitySubscribeOptions,
  ): () => void;
  start(): void;
  stop(): void;
  setMode(mode: ConnectivityMode): void;
  refresh?(): Promise<ConnectivitySnapshot>;
}

export interface ManualConnectivityWatcherOptions {
  initialState?: ConnectivityState;
  initialMode?: ConnectivityMode;
  now?: () => number;
}

function callListener(
  listener: ConnectivityListener,
  next: ConnectivitySnapshot,
  previous: ConnectivitySnapshot,
): void {
  try {
    const result = listener(next, previous);
    if (result && typeof (result as PromiseLike<void>).then === 'function') {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Connectivity is an observability/lifecycle hint. A consumer callback may
    // never make queue durability or future state delivery fail.
  }
}

/**
 * Runtime-neutral watcher used by Node, SSR, tests, and native bridges.
 *
 * Native adapters call publish after platform callbacks or a successful
 * reachability probe. While total-offline mode is enabled, automatic updates
 * are cached but not exposed; restoring automatic mode publishes the newest
 * cached state immediately.
 */
export class ManualConnectivityWatcher implements ConnectivityWatcher {
  private readonly listeners = new Set<ConnectivityListener>();
  private readonly now: () => number;
  private current: ConnectivitySnapshot;
  private automatic: ConnectivitySnapshot;

  constructor(options: ManualConnectivityWatcherOptions = {}) {
    this.now = options.now ?? Date.now;
    const changedAt = this.now();
    this.automatic = Object.freeze({
      state: options.initialState ?? 'unknown',
      mode: 'automatic',
      source: 'initial',
      changedAt,
    });
    this.current =
      options.initialMode === 'offline'
        ? Object.freeze({
            state: 'offline',
            mode: 'offline',
            source: 'forced-offline',
            changedAt,
          })
        : this.automatic;
  }

  snapshot(): ConnectivitySnapshot {
    return this.current;
  }

  subscribe(
    listener: ConnectivityListener,
    options: ConnectivitySubscribeOptions = {},
  ): () => void {
    this.listeners.add(listener);
    if (options.emitCurrent !== false) {
      callListener(listener, this.current, this.current);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    // Manual/native bridges are push-driven.
  }

  stop(): void {
    // Stopping a bridge is owned by the bridge itself. Listener state remains
    // available so a later restart does not invent an offline transition.
  }

  async refresh(): Promise<ConnectivitySnapshot> {
    return this.current;
  }

  setMode(mode: ConnectivityMode): void {
    if (mode === this.current.mode) return;
    if (mode === 'offline') {
      this.transition({
        state: 'offline',
        mode: 'offline',
        source: 'forced-offline',
      });
      return;
    }
    this.transition({
      state: this.automatic.state,
      mode: 'automatic',
      source: this.automatic.source,
      verifiedAt: this.automatic.verifiedAt,
    });
  }

  setTotalOffline(enabled: boolean): void {
    this.setMode(enabled ? 'offline' : 'automatic');
  }

  /** Publish a platform observation or verified probe result. */
  publish(
    state: ConnectivityState,
    source: Exclude<ConnectivitySource, 'forced-offline'> = 'manual',
    verifiedAt?: number,
  ): ConnectivitySnapshot {
    const observedAt = this.now();
    const normalizedVerifiedAt =
      state === 'internet' ? verifiedAt ?? observedAt : undefined;
    this.automatic = Object.freeze({
      state,
      mode: 'automatic',
      source,
      changedAt:
        state === this.automatic.state
          ? this.automatic.changedAt
          : observedAt,
      verifiedAt: normalizedVerifiedAt,
    });

    if (this.current.mode === 'automatic') {
      this.transition({
        state,
        mode: 'automatic',
        source,
        verifiedAt: normalizedVerifiedAt,
      });
    }
    return this.current;
  }

  protected transition(
    next: Omit<ConnectivitySnapshot, 'changedAt'>,
  ): ConnectivitySnapshot {
    const previous = this.current;
    const semanticChange =
      previous.state !== next.state || previous.mode !== next.mode;

    this.current = Object.freeze({
      ...next,
      changedAt: semanticChange ? this.now() : previous.changedAt,
    });

    if (!semanticChange) return this.current;
    for (const listener of [...this.listeners]) {
      callListener(listener, this.current, previous);
    }
    return this.current;
  }
}

export interface BrowserConnectivityHost {
  readonly navigator?: { readonly onLine?: boolean };
  readonly location?: { readonly href?: string; readonly origin?: string };
  readonly fetch?: typeof fetch;
  addEventListener(type: 'online' | 'offline', listener: EventListener): void;
  removeEventListener(type: 'online' | 'offline', listener: EventListener): void;
}

export interface BrowserConnectivityWatcherOptions
  extends ManualConnectivityWatcherOptions {
  /**
   * Same-origin endpoint used to verify actual internet/server reachability.
   * Without this, browser signals yield `link`, never `internet`.
   */
  probeUrl?: string;
  probeMethod?: 'HEAD' | 'GET';
  probeTimeoutMs?: number;
  /** Periodic verification while link is available. Zero disables it. */
  probeIntervalMs?: number;
  host?: BrowserConnectivityHost;
  fetch?: typeof fetch;
}

function defaultBrowserHost(): BrowserConnectivityHost | undefined {
  const value = globalThis as unknown as Partial<BrowserConnectivityHost>;
  if (
    typeof value.addEventListener !== 'function' ||
    typeof value.removeEventListener !== 'function'
  ) {
    return undefined;
  }
  return value as BrowserConnectivityHost;
}

/** Browser, service-worker, and TypeScript/WASM-host connectivity watcher. */
export class BrowserConnectivityWatcher
  extends ManualConnectivityWatcher
  implements ConnectivityWatcher
{
  private readonly host: BrowserConnectivityHost;
  private readonly fetchImpl?: typeof fetch;
  private readonly probeUrl?: string;
  private readonly probeMethod: 'HEAD' | 'GET';
  private readonly probeTimeoutMs: number;
  private readonly probeIntervalMs: number;
  private started = false;
  private probePromise?: Promise<ConnectivitySnapshot>;
  private probeController?: AbortController;
  private timer?: ReturnType<typeof setInterval>;

  private readonly handleOnline = (): void => {
    if (this.snapshot().mode === 'offline') return;
    this.publish('link', 'browser-event');
    void this.refresh();
  };

  private readonly handleOffline = (): void => {
    if (this.snapshot().mode === 'offline') return;
    this.cancelProbe();
    this.publish('offline', 'browser-event');
  };

  constructor(options: BrowserConnectivityWatcherOptions = {}) {
    super(options);
    const host = options.host ?? defaultBrowserHost();
    if (!host) {
      throw new Error(
        'BrowserConnectivityWatcher requires a browser-like event host',
      );
    }
    this.host = host;
    this.fetchImpl =
      options.fetch ??
      (host.fetch ? ((...args) => host.fetch!(...args)) : undefined);
    this.probeMethod = options.probeMethod ?? 'HEAD';
    this.probeTimeoutMs = options.probeTimeoutMs ?? 4_000;
    this.probeIntervalMs = options.probeIntervalMs ?? 30_000;

    if (!Number.isFinite(this.probeTimeoutMs) || this.probeTimeoutMs <= 0) {
      throw new RangeError('probeTimeoutMs must be greater than zero');
    }
    if (!Number.isFinite(this.probeIntervalMs) || this.probeIntervalMs < 0) {
      throw new RangeError('probeIntervalMs must be non-negative');
    }

    this.probeUrl = options.probeUrl
      ? this.resolveSameOriginProbe(options.probeUrl)
      : undefined;
    if (this.probeUrl && !this.fetchImpl) {
      throw new Error('probeUrl requires a fetch implementation');
    }
  }

  override start(): void {
    if (this.started) return;
    this.started = true;
    this.host.addEventListener('online', this.handleOnline);
    this.host.addEventListener('offline', this.handleOffline);
    this.observeBrowserLink();
    this.schedulePeriodicProbe();
    void this.refresh();
  }

  override stop(): void {
    if (!this.started) return;
    this.started = false;
    this.host.removeEventListener('online', this.handleOnline);
    this.host.removeEventListener('offline', this.handleOffline);
    this.cancelProbe();
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  override setMode(mode: ConnectivityMode): void {
    const previous = this.snapshot().mode;
    if (mode === previous) return;

    if (mode === 'offline') {
      super.setMode(mode);
      this.cancelProbe();
      if (this.timer !== undefined) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      return;
    }

    // While the explicit offline override is still authoritative, replace any
    // cached, previously verified internet state with the browser's current
    // link observation. Then restoring automatic mode exposes Link/Offline,
    // and a fresh bounded probe can promote it to Internet exactly once. This
    // avoids a stale Internet -> Link -> Internet sequence and duplicate sync
    // wake hints when total-offline mode is disabled.
    this.publish(
      this.isBrowserOffline() ? 'offline' : 'link',
      'browser-event',
    );
    super.setMode(mode);
    if (this.started) {
      this.schedulePeriodicProbe();
      void this.refresh();
    }
  }

  override async refresh(): Promise<ConnectivitySnapshot> {
    if (this.snapshot().mode === 'offline') return this.snapshot();
    if (this.isBrowserOffline()) {
      this.publish('offline', 'browser-event');
      return this.snapshot();
    }
    if (!this.probeUrl || !this.fetchImpl) {
      this.publish('link', 'browser-event');
      return this.snapshot();
    }
    if (this.probePromise) return this.probePromise;

    const controller = new AbortController();
    this.probeController = controller;
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);

    this.probePromise = this.fetchImpl(this.probeUrl, {
      method: this.probeMethod,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(() => {
        if (this.snapshot().mode === 'automatic') {
          this.publish('internet', 'probe');
        }
        return this.snapshot();
      })
      .catch(() => {
        if (this.snapshot().mode === 'automatic') {
          this.publish(
            this.isBrowserOffline() ? 'offline' : 'link',
            'probe',
          );
        }
        return this.snapshot();
      })
      .finally(() => {
        clearTimeout(timeout);
        if (this.probeController === controller) {
          this.probeController = undefined;
        }
        this.probePromise = undefined;
      });

    return this.probePromise;
  }

  private resolveSameOriginProbe(probeUrl: string): string {
    const base = this.host.location?.href ?? this.host.location?.origin;
    if (!base) {
      if (/^[a-z][a-z\d+.-]*:/i.test(probeUrl)) {
        throw new Error(
          'absolute probeUrl requires a host location for same-origin validation',
        );
      }
      return probeUrl;
    }
    const resolved = new URL(probeUrl, base);
    const origin = new URL(base).origin;
    if (resolved.origin !== origin) {
      throw new Error('connectivity probeUrl must be same-origin');
    }
    return resolved.href;
  }

  private observeBrowserLink(): void {
    if (this.snapshot().mode === 'offline') return;
    this.publish(
      this.isBrowserOffline() ? 'offline' : 'link',
      'browser-event',
    );
  }

  private isBrowserOffline(): boolean {
    return this.host.navigator?.onLine === false;
  }

  private schedulePeriodicProbe(): void {
    if (
      this.timer !== undefined ||
      !this.started ||
      this.snapshot().mode === 'offline' ||
      !this.probeUrl ||
      this.probeIntervalMs === 0
    ) {
      return;
    }
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.probeIntervalMs);
  }

  private cancelProbe(): void {
    this.probeController?.abort();
    this.probeController = undefined;
  }
}

/**
 * Choose the browser watcher when DOM-style lifecycle events exist; otherwise
 * return a manual watcher suitable for Node, SSR, tests, and native bridges.
 */
export function createDefaultConnectivityWatcher(
  browserOptions: Omit<BrowserConnectivityWatcherOptions, 'host'> = {},
): ConnectivityWatcher {
  const host = defaultBrowserHost();
  return host
    ? new BrowserConnectivityWatcher({ ...browserOptions, host })
    : new ManualConnectivityWatcher(browserOptions);
}
