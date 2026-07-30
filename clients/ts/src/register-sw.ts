/**
 * Window-side registration and wiring for background sync.
 *
 * Decides, by feature detection, how queued mutations get drained when the
 * page cannot do it:
 *
 * 1. Background Sync API available → `registration.sync.register(tag)` after
 *    every durable queue commit; the service worker drains, even after the
 *    tab closes.
 * 2. Periodic Background Sync available AND permission granted → additionally
 *    registers a periodic catch-up.
 * 3. Neither (Safari, Firefox) → in-page fallback: the supplied
 *    `ProtocolSyncLoop` is started, and it already listens for `online` /
 *    `visibilitychange`, so the queue drains whenever a tab is alive.
 *
 * Cross-tab: pair this with `startCrossTabCoordinator` so only the elected
 * leader tab runs the in-page loop while every tab can request a drain.
 */
import type { OptoSyncClient } from './client.js';
import type { ProtocolSyncLoop } from './sync-loop.js';
import { DEFAULT_PERIODIC_SYNC_TAG, DEFAULT_SYNC_TAG, SYNC_MESSAGE_TYPE } from './service-worker.js';

/** Structural subsets so tests and non-DOM typings can supply fakes. */
export interface SyncManagerLike {
  register(tag: string): Promise<void>;
}
export interface PeriodicSyncManagerLike {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  unregister?(tag: string): Promise<void>;
}
export interface ServiceWorkerRegistrationLike {
  sync?: SyncManagerLike;
  periodicSync?: PeriodicSyncManagerLike;
  active?: { postMessage(value: unknown, transfer?: unknown[]): void } | null;
}
export interface ServiceWorkerContainerLike {
  register(
    url: string,
    options?: { scope?: string; type?: 'classic' | 'module' },
  ): Promise<ServiceWorkerRegistrationLike>;
  ready: Promise<ServiceWorkerRegistrationLike>;
}
export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

export type BackgroundSyncStrategy = 'background-sync' | 'in-page';

export interface RegisterBackgroundSyncOptions {
  /**
   * URL of the service worker script to register. Omit when the application
   * has already registered one — then `serviceWorker.ready` is used.
   */
  serviceWorkerUrl?: string;
  serviceWorkerType?: 'classic' | 'module';
  serviceWorkerScope?: string;
  /** Wire `onMutationQueued` of this client to the chosen strategy. */
  client?: OptoSyncClient;
  /**
   * In-page loop for the fallback strategy (and for foreground syncing —
   * running it alongside Background Sync is safe and gives lower latency
   * while a tab is open). Required when Background Sync is unavailable.
   */
  loop?: ProtocolSyncLoop;
  syncTag?: string;
  periodicSyncTag?: string;
  /** Minimum interval for periodic sync, in ms. Default 12 hours. */
  periodicMinIntervalMs?: number;
  /** Also start `loop` when Background Sync IS available. Default true. */
  runLoopInForeground?: boolean;
  /** Injectable platform hooks (default: real navigator). */
  serviceWorkerContainer?: ServiceWorkerContainerLike;
  permissions?: PermissionsLike;
}

export interface BackgroundSyncHandle {
  strategy: BackgroundSyncStrategy;
  periodic: boolean;
  registration?: ServiceWorkerRegistrationLike;
  /**
   * Ask for a drain soon. Never rejects — schedule failures degrade to the
   * in-page loop when one is present.
   */
  requestSync(): Promise<void>;
  /** Explicitly message the service worker to drain now (if registered). */
  drainViaWorker(): void;
  dispose(): void;
}

function defaultContainer(): ServiceWorkerContainerLike | undefined {
  const nav = (globalThis as { navigator?: { serviceWorker?: unknown } }).navigator;
  return nav?.serviceWorker as ServiceWorkerContainerLike | undefined;
}

function defaultPermissions(): PermissionsLike | undefined {
  const nav = (globalThis as { navigator?: { permissions?: unknown } }).navigator;
  return nav?.permissions as PermissionsLike | undefined;
}

/**
 * Register (or adopt) a service worker and wire the client's queue commits to
 * the best available background drain strategy.
 */
export async function registerBackgroundSync(
  options: RegisterBackgroundSyncOptions = {},
): Promise<BackgroundSyncHandle> {
  const syncTag = options.syncTag ?? DEFAULT_SYNC_TAG;
  const periodicSyncTag = options.periodicSyncTag ?? DEFAULT_PERIODIC_SYNC_TAG;
  const container = options.serviceWorkerContainer ?? defaultContainer();

  let registration: ServiceWorkerRegistrationLike | undefined;
  if (container) {
    try {
      if (options.serviceWorkerUrl) {
        await container.register(options.serviceWorkerUrl, {
          scope: options.serviceWorkerScope,
          type: options.serviceWorkerType ?? 'module',
        });
      }
      registration = await container.ready;
    } catch {
      registration = undefined; // fall through to in-page
    }
  }

  const backgroundSyncAvailable = typeof registration?.sync?.register === 'function';
  const strategy: BackgroundSyncStrategy = backgroundSyncAvailable
    ? 'background-sync'
    : 'in-page';

  if (strategy === 'in-page' && !options.loop) {
    throw new Error(
      'Background Sync is unavailable here; registerBackgroundSync requires `loop` for the in-page fallback',
    );
  }

  let periodic = false;
  if (registration?.periodicSync && typeof registration.periodicSync.register === 'function') {
    try {
      const permissions = options.permissions ?? defaultPermissions();
      const status = await permissions?.query({
        name: 'periodic-background-sync',
      });
      if (status?.state === 'granted') {
        await registration.periodicSync.register(periodicSyncTag, {
          minInterval: options.periodicMinIntervalMs ?? 12 * 60 * 60 * 1000,
        });
        periodic = true;
      }
    } catch {
      periodic = false; // permission model varies; treat any failure as absent
    }
  }

  const requestSync = async (): Promise<void> => {
    if (backgroundSyncAvailable) {
      try {
        await registration!.sync!.register(syncTag);
        return;
      } catch {
        // e.g. permission denied at the browser level; degrade below.
      }
    }
    options.loop?.hint();
  };

  const drainViaWorker = (): void => {
    try {
      registration?.active?.postMessage({ type: SYNC_MESSAGE_TYPE });
    } catch {
      // absent/stopped worker: background sync or the loop still cover us
    }
  };

  // Foreground loop: low-latency sync while a tab is open; Background Sync
  // covers the tab-closed case. Push dedupe makes the overlap safe.
  const runForegroundLoop =
    options.loop && (strategy === 'in-page' || options.runLoopInForeground !== false);
  if (runForegroundLoop) options.loop!.start();

  options.client?.setBackgroundSyncTrigger(() => {
    void requestSync();
  });

  return {
    strategy,
    periodic,
    registration,
    requestSync,
    drainViaWorker,
    dispose() {
      options.client?.setBackgroundSyncTrigger(undefined);
      if (runForegroundLoop) options.loop!.stop();
    },
  };
}
