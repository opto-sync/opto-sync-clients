import type {
  ProtocolQueueAdapter,
  ProtocolSyncCallbacks,
  ProtocolSyncCycleResult,
  ProtocolSyncLoopOptions,
  ProtocolTransport,
} from './sync-loop.js';
import { ProtocolSyncLoop } from './sync-loop.js';

export const OPTO_SYNC_MESSAGE = 'opto-sync:sync';
export const DEFAULT_BACKGROUND_SYNC_TAG = 'opto-sync:flush';
export const DEFAULT_PERIODIC_SYNC_TAG = 'opto-sync:periodic';

interface SyncManagerLike {
  register(tag: string): Promise<void>;
  getTags?(): Promise<string[]>;
}

interface PeriodicSyncManagerLike {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  getTags?(): Promise<string[]>;
}

type ExtendedServiceWorkerRegistration = ServiceWorkerRegistration & {
  sync?: SyncManagerLike;
  periodicSync?: PeriodicSyncManagerLike;
};

interface LifetimeEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface TaggedLifetimeEvent extends LifetimeEvent {
  tag?: string;
}

interface MessageLifetimeEvent extends LifetimeEvent {
  data?: unknown;
  ports?: readonly MessagePort[];
}

interface ServiceWorkerScopeLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  skipWaiting?(): Promise<void>;
  clients?: {
    claim(): Promise<void>;
  };
}

export interface RegisterOptoSyncServiceWorkerOptions {
  scriptUrl: string | URL;
  scope?: string;
  type?: WorkerType;
  updateViaCache?: ServiceWorkerUpdateViaCache;
  syncTag?: string;
  periodicSync?: {
    tag?: string;
    minIntervalMs: number;
  };
}

export interface OptoSyncServiceWorkerRegistration {
  registration: ServiceWorkerRegistration;
  requestSync(): Promise<'background-sync' | 'message'>;
}

function workerTarget(
  registration: ServiceWorkerRegistration,
): ServiceWorker | null {
  return (
    registration.active ??
    registration.waiting ??
    registration.installing ??
    null
  );
}

/**
 * Request one durable service-worker flush.
 *
 * Background Sync is preferred when available. Browsers without it receive an
 * immediate worker message; online/visibility hooks should remain enabled as
 * an additional fallback because a message cannot wake a terminated worker.
 */
export async function requestServiceWorkerSync(
  registration: ServiceWorkerRegistration,
  syncTag = DEFAULT_BACKGROUND_SYNC_TAG,
): Promise<'background-sync' | 'message'> {
  const extended = registration as ExtendedServiceWorkerRegistration;
  if (extended.sync) {
    await extended.sync.register(syncTag);
    return 'background-sync';
  }
  const target = workerTarget(registration);
  if (!target) throw new Error('service worker is not active yet');
  target.postMessage({ type: OPTO_SYNC_MESSAGE, tag: syncTag });
  return 'message';
}

/**
 * Register the application-owned worker and expose the exact callback expected
 * by `OptoSyncClient.setBackgroundSyncTrigger`.
 */
export async function registerOptoSyncServiceWorker(
  options: RegisterOptoSyncServiceWorkerOptions,
): Promise<OptoSyncServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    throw new Error('service workers are unavailable in this runtime');
  }
  const registration = await navigator.serviceWorker.register(
    options.scriptUrl,
    {
      scope: options.scope,
      type: options.type ?? 'module',
      updateViaCache: options.updateViaCache,
    },
  );
  await navigator.serviceWorker.ready;
  const periodic = options.periodicSync;
  const extended = registration as ExtendedServiceWorkerRegistration;
  if (periodic && extended.periodicSync) {
    await extended.periodicSync.register(
      periodic.tag ?? DEFAULT_PERIODIC_SYNC_TAG,
      { minInterval: periodic.minIntervalMs },
    );
  }
  return {
    registration,
    requestSync: () =>
      requestServiceWorkerSync(
        registration,
        options.syncTag ?? DEFAULT_BACKGROUND_SYNC_TAG,
      ),
  };
}

/** Fire-and-forget wake hook for `OptoSyncClient.setBackgroundSyncTrigger`. */
export function createServiceWorkerSyncTrigger(
  registration:
    | ServiceWorkerRegistration
    | Promise<ServiceWorkerRegistration>
    | OptoSyncServiceWorkerRegistration
    | Promise<OptoSyncServiceWorkerRegistration>,
  syncTag = DEFAULT_BACKGROUND_SYNC_TAG,
  onError?: (error: unknown) => void,
): () => void {
  return () => {
    void Promise.resolve(registration)
      .then((resolved) => {
        if ('requestSync' in resolved) return resolved.requestSync();
        return requestServiceWorkerSync(resolved, syncTag);
      })
      .catch((error) => onError?.(error));
  };
}

export type ServiceWorkerSyncReason =
  | 'background-sync'
  | 'periodic-sync'
  | 'message'
  | 'push'
  | 'manual';

export interface ServiceWorkerRuntimeOptions {
  runSync(reason: ServiceWorkerSyncReason): Promise<unknown>;
  scope?: ServiceWorkerScopeLike;
  syncTag?: string;
  periodicSyncTag?: string;
  syncOnPush?: boolean;
  skipWaiting?: boolean;
  claimClients?: boolean;
  onError?: (error: unknown, reason: ServiceWorkerSyncReason) => void;
}

export interface ServiceWorkerSyncRuntime {
  runNow(): Promise<unknown>;
  dispose(): void;
}

/**
 * Install bounded sync event handlers in a service worker.
 *
 * Concurrent wakeups share one run and request exactly one follow-up cycle.
 * No timer or permanent socket is kept alive—the browser is free to terminate
 * the worker after each event without risking the durable queue.
 */
export function installOptoSyncServiceWorker(
  options: ServiceWorkerRuntimeOptions,
): ServiceWorkerSyncRuntime {
  const scope =
    options.scope ??
    (globalThis as unknown as ServiceWorkerScopeLike);
  const syncTag = options.syncTag ?? DEFAULT_BACKGROUND_SYNC_TAG;
  const periodicTag =
    options.periodicSyncTag ?? DEFAULT_PERIODIC_SYNC_TAG;
  let inFlight: Promise<unknown> | undefined;
  let rerun = false;
  let disposed = false;

  const run = (reason: ServiceWorkerSyncReason): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error('service worker runtime disposed'));
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    const running = (async () => {
      let result: unknown;
      do {
        rerun = false;
        try {
          result = await options.runSync(reason);
        } catch (error) {
          options.onError?.(error, reason);
          throw error;
        }
      } while (rerun);
      return result;
    })().finally(() => {
      inFlight = undefined;
    });
    inFlight = running;
    return running;
  };

  const installListener: EventListener = (raw) => {
    if (!options.skipWaiting) return;
    (raw as LifetimeEvent).waitUntil(
      scope.skipWaiting?.() ?? Promise.resolve(),
    );
  };
  const activateListener: EventListener = (raw) => {
    if (!options.claimClients) return;
    (raw as LifetimeEvent).waitUntil(
      scope.clients?.claim() ?? Promise.resolve(),
    );
  };
  const syncListener: EventListener = (raw) => {
    const event = raw as TaggedLifetimeEvent;
    if (event.tag === syncTag) event.waitUntil(run('background-sync'));
  };
  const periodicListener: EventListener = (raw) => {
    const event = raw as TaggedLifetimeEvent;
    if (event.tag === periodicTag) event.waitUntil(run('periodic-sync'));
  };
  const messageListener: EventListener = (raw) => {
    const event = raw as MessageLifetimeEvent;
    if (
      !event.data ||
      typeof event.data !== 'object' ||
      (event.data as { type?: unknown }).type !== OPTO_SYNC_MESSAGE
    ) {
      return;
    }
    const pending = run('message');
    event.waitUntil(pending);
    void pending.then(
      () => event.ports?.[0]?.postMessage({ ok: true }),
      (error) =>
        event.ports?.[0]?.postMessage({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };
  const pushListener: EventListener = (raw) => {
    if (options.syncOnPush) {
      (raw as LifetimeEvent).waitUntil(run('push'));
    }
  };

  scope.addEventListener('install', installListener);
  scope.addEventListener('activate', activateListener);
  scope.addEventListener('sync', syncListener);
  scope.addEventListener('periodicsync', periodicListener);
  scope.addEventListener('message', messageListener);
  scope.addEventListener('push', pushListener);

  return {
    runNow: () => run('manual'),
    dispose: () => {
      disposed = true;
      scope.removeEventListener('install', installListener);
      scope.removeEventListener('activate', activateListener);
      scope.removeEventListener('sync', syncListener);
      scope.removeEventListener('periodicsync', periodicListener);
      scope.removeEventListener('message', messageListener);
      scope.removeEventListener('push', pushListener);
    },
  };
}

export interface ProtocolServiceWorkerOptions {
  queue: ProtocolQueueAdapter;
  transport: ProtocolTransport;
  callbacks: ProtocolSyncCallbacks;
  loop?: ProtocolSyncLoopOptions;
  runtime?: Omit<ServiceWorkerRuntimeOptions, 'runSync'>;
  onCycle?: (result: Readonly<ProtocolSyncCycleResult>) => void;
}

/**
 * Wire the normal protocol v1 loop into service-worker lifecycle events.
 *
 * The loop is intentionally not `start()`ed: each OS/browser wake gets one
 * bounded `syncNow()` cycle and `event.waitUntil()` owns its lifetime.
 */
export function installProtocolServiceWorker(
  options: ProtocolServiceWorkerOptions,
): ServiceWorkerSyncRuntime {
  const loop = new ProtocolSyncLoop(
    options.queue,
    options.transport,
    options.callbacks,
    {
      ...options.loop,
      observeBrowserLifecycle: false,
    },
  );
  return installOptoSyncServiceWorker({
    ...options.runtime,
    runSync: async () => {
      const result = await loop.syncNow();
      options.onCycle?.(result);
      return result;
    },
  });
}
