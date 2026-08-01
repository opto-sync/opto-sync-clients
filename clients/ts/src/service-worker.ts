/**
 * Service-worker side of background synchronization.
 *
 * Import this from the application's service worker bundle and call
 * `installOptoSyncServiceWorker` at the top level (handlers must be attached
 * during the worker script's first evaluation):
 *
 *     // sw.ts
 *     import { installOptoSyncServiceWorker } from '@opto-sync/client/service-worker';
 *     import { initOptoSync, OptoSyncClient, ProtocolSyncLoop } from '@opto-sync/client';
 *
 *     installOptoSyncServiceWorker({
 *       async createSession() {
 *         await initOptoSync();                     // wasm engine works in workers
 *         const client = new OptoSyncClient({ databaseName: 'app' });
 *         const loop = new ProtocolSyncLoop(client, transport, callbacks, {
 *           observeBrowserLifecycle: false,         // no window here
 *         });
 *         return { loop };
 *       },
 *     });
 *
 * The service worker opens the SAME IndexedDB database as the page, so a drain
 * performed here pushes exactly the rows the page queued. `ProtocolSyncLoop`
 * and `OptoSyncClient` are storage-transactional and single-flight, so a page
 * syncing at the same moment is safe — pushes are idempotent via
 * (clientId, mutationId) dedupe and the loser of any race simply no-ops.
 *
 * Event contract implemented here:
 * - `sync` (Background Sync API): one-shot, fired by the browser when
 *   connectivity returns — including after the page is closed. A failed drain
 *   rethrows so the browser retries with its own backoff.
 * - `periodicsync` (Periodic Background Sync, Chromium): scheduled catch-up.
 * - `message` `{type: 'opto-sync:sync'}`: an explicit drain request from a
 *   window; replies on `event.ports[0]` when a MessageChannel port is given.
 */
import type { ProtocolSyncCycleResult, ProtocolSyncLoop } from './sync-loop.js';

export const DEFAULT_SYNC_TAG = 'opto-sync';
export const DEFAULT_PERIODIC_SYNC_TAG = 'opto-sync-periodic';
export const SYNC_MESSAGE_TYPE = 'opto-sync:sync';

/** Structural subset of ServiceWorkerGlobalScope used here (testable). */
export interface ServiceWorkerScopeLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
}

export interface ServiceWorkerSyncSession {
  /**
   * The loop to drain with. It is NOT `start()`ed here — the worker runs
   * one-shot cycles via `syncNow()` and lets the browser own scheduling.
   */
  loop: Pick<ProtocolSyncLoop, 'syncNow'>;
}

export interface InstallServiceWorkerSyncOptions {
  /**
   * Builds the session (engine init + client + loop) on first use. Called
   * lazily and cached: a worker woken only for a push notification never pays
   * for wasm instantiation.
   */
  createSession: () =>
    | ServiceWorkerSyncSession
    | Promise<ServiceWorkerSyncSession>;
  /** Tag accepted from `sync` events. Default {@link DEFAULT_SYNC_TAG}. */
  syncTag?: string;
  /** Tag accepted from `periodicsync` events. Default {@link DEFAULT_PERIODIC_SYNC_TAG}. */
  periodicSyncTag?: string;
  /** postMessage discriminator. Default {@link SYNC_MESSAGE_TYPE}. */
  messageType?: string;
  /** Worker global to attach to. Default `globalThis` (i.e. `self`). */
  scope?: ServiceWorkerScopeLike;
  /** Observability only; failures are already rethrown to the event. */
  onError?: (error: unknown) => void;
}

export interface ServiceWorkerSyncHandle {
  /** Drain once now (single-flight with any event-driven drain). */
  drain(): Promise<ProtocolSyncCycleResult>;
  /** Detach all listeners (tests; a real worker just terminates). */
  dispose(): void;
}

/**
 * Attach Background Sync / Periodic Background Sync / message handlers that
 * drain the opto-sync mutation queue. Returns the drain for direct use.
 */
export function installOptoSyncServiceWorker(
  options: InstallServiceWorkerSyncOptions,
): ServiceWorkerSyncHandle {
  const scope =
    options.scope ?? (globalThis as unknown as ServiceWorkerScopeLike);
  const syncTag = options.syncTag ?? DEFAULT_SYNC_TAG;
  const periodicSyncTag = options.periodicSyncTag ?? DEFAULT_PERIODIC_SYNC_TAG;
  const messageType = options.messageType ?? SYNC_MESSAGE_TYPE;

  // The worker global carries its own origin; read it from `scope` so the
  // check is exercisable with an injected scope instead of only in a browser.
  const selfOrigin = (scope as unknown as { origin?: unknown }).origin;

  let sessionPromise: Promise<ServiceWorkerSyncSession> | undefined;
  const session = () => {
    // A failed creation is not cached, so a transient failure (e.g. wasm
    // fetch offline) is retried by the next sync event instead of bricking
    // the worker until it restarts.
    if (!sessionPromise) {
      sessionPromise = Promise.resolve(options.createSession()).catch(
        (error) => {
          sessionPromise = undefined;
          throw error;
        },
      );
    }
    return sessionPromise;
  };

  const drain = async (): Promise<ProtocolSyncCycleResult> => {
    try {
      const { loop } = await session();
      return await loop.syncNow();
    } catch (error) {
      try {
        options.onError?.(error);
      } catch {
        // observability must not mask the real failure
      }
      // Rethrow: for a `sync` event this makes waitUntil reject, which is the
      // documented way to ask the browser to retry the tag later.
      throw error;
    }
  };

  const onSync = (event: { tag?: string; waitUntil?: (p: Promise<unknown>) => void }) => {
    if (event.tag !== syncTag) return;
    const work = drain();
    if (event.waitUntil) {
      event.waitUntil(work);
    } else {
      // No waitUntil (non-standard host, or a synthetic event): `drain()`
      // always rethrows, so leaving the promise unobserved would surface as
      // an unhandled rejection and can terminate the worker.
      void work.catch(() => undefined);
    }
  };
  const onPeriodicSync = (event: {
    tag?: string;
    waitUntil?: (p: Promise<unknown>) => void;
  }) => {
    if (event.tag !== periodicSyncTag) return;
    // Periodic events are best-effort catch-ups; swallow failures so the
    // browser does not deprioritize the periodic registration.
    event.waitUntil?.(drain().catch(() => undefined));
  };
  const onMessage = (event: {
    data?: { type?: string };
    origin?: string;
    ports?: ReadonlyArray<{ postMessage(value: unknown): void }>;
    waitUntil?: (p: Promise<unknown>) => void;
  }) => {
    if (event.data?.type !== messageType) return;
    // Defence in depth: only a same-origin client should ever be able to reach
    // a service worker, but a drain touches the durable queue and replies with
    // the sync checkpoint, so the origin is checked rather than assumed.
    // Checked only when the host actually reports one, so synthetic events and
    // non-DOM test scopes keep working.
    if (
      typeof event.origin === 'string' &&
      event.origin !== '' &&
      typeof selfOrigin === 'string' &&
      event.origin !== selfOrigin
    ) {
      return;
    }
    const port = event.ports?.[0];
    const work = drain().then(
      (result) => port?.postMessage({ ok: true, result }),
      (error) =>
        port?.postMessage({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    event.waitUntil?.(work);
  };

  scope.addEventListener('sync', onSync);
  scope.addEventListener('periodicsync', onPeriodicSync);
  scope.addEventListener('message', onMessage);

  return {
    drain,
    dispose() {
      scope.removeEventListener?.('sync', onSync);
      scope.removeEventListener?.('periodicsync', onPeriodicSync);
      scope.removeEventListener?.('message', onMessage);
    },
  };
}
