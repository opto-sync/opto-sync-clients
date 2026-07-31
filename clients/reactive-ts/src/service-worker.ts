export const OPTO_SYNC_BACKGROUND_TAG = 'opto-sync:background';
export const OPTO_SYNC_WAKE_MESSAGE = 'opto-sync:sync';
export const OPTO_SYNC_RESULT_MESSAGE = 'opto-sync:sync-result';

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface SyncEventLike extends ExtendableEventLike {
  tag?: string;
}

export interface MessageEventLike extends ExtendableEventLike {
  data?: unknown;
  source?: { postMessage(value: unknown): void } | null;
}

export interface ServiceWorkerScopeLike {
  addEventListener(
    type: 'sync' | 'periodicsync' | 'message' | 'activate',
    listener: (
      event: SyncEventLike | MessageEventLike | ExtendableEventLike,
    ) => void,
  ): void;
  removeEventListener(
    type: 'sync' | 'periodicsync' | 'message' | 'activate',
    listener: (
      event: SyncEventLike | MessageEventLike | ExtendableEventLike,
    ) => void,
  ): void;
}

export interface ServiceWorkerSyncOptions<R = unknown> {
  scope: ServiceWorkerScopeLike;
  syncOnce(signal: AbortSignal): Promise<R>;
  tag?: string;
  timeoutMs?: number;
  runOnActivate?: boolean;
  onError?: (error: unknown) => void;
}

export interface ServiceWorkerSyncController<R = unknown> {
  runNow(): Promise<R>;
  close(): void;
}

function wakeRequest(value: unknown): { requestId?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as { type?: unknown; requestId?: unknown };
  if (request.type !== OPTO_SYNC_WAKE_MESSAGE) return null;
  return {
    requestId:
      typeof request.requestId === 'string'
        ? request.requestId.slice(0, 128)
        : undefined,
  };
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

/**
 * Install a bounded, idempotent service-worker protocol cycle.
 *
 * Service workers are event-driven and may be terminated after any event. The
 * callback must therefore use the durable queue/checkpoint and finish one HTTP
 * push/pull cycle; it must not depend on a permanent WebSocket or in-memory
 * retry timer. Concurrent sync/message events share one visible promise. If a
 * callback ignores cancellation, that settled timeout remains installed until
 * the underlying callback actually returns so a later event cannot overlap it.
 */
export function installOptoSyncServiceWorker<R>(
  options: ServiceWorkerSyncOptions<R>,
): ServiceWorkerSyncController<R> {
  const tag = options.tag ?? OPTO_SYNC_BACKGROUND_TAG;
  const timeoutMs = options.timeoutMs ?? 25_000;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 10 * 60_000
  ) {
    throw new RangeError('timeoutMs must be from 1000 through 600000');
  }
  let operation: Promise<R> | undefined;
  let visibleResult: Promise<R> | undefined;
  let activeController: AbortController | undefined;
  let closed = false;

  const clearIfCurrent = (
    currentOperation: Promise<R>,
    controller: AbortController,
    timer: ReturnType<typeof setTimeout>,
  ): void => {
    if (operation !== currentOperation) return;
    clearTimeout(timer);
    operation = undefined;
    visibleResult = undefined;
    if (activeController === controller) activeController = undefined;
  };

  const runNow = (): Promise<R> => {
    if (closed) {
      return Promise.reject(
        new Error('service-worker sync controller is closed'),
      );
    }
    if (visibleResult) return visibleResult;

    const controller = new AbortController();
    activeController = controller;
    const currentOperation = Promise.resolve().then(() =>
      options.syncOnce(controller.signal),
    );
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = abortError('opto-sync background timeout');
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const currentVisible = Promise.race([currentOperation, deadline]).catch(
      (error) => {
        options.onError?.(error);
        throw error;
      },
    );
    operation = currentOperation;
    visibleResult = currentVisible;
    currentOperation.then(
      () => clearIfCurrent(currentOperation, controller, timer),
      () => clearIfCurrent(currentOperation, controller, timer),
    );
    return currentVisible;
  };

  const syncListener = (
    raw: SyncEventLike | MessageEventLike | ExtendableEventLike,
  ) => {
    const event = raw as SyncEventLike;
    if (event.tag !== tag) return;
    event.waitUntil(runNow());
  };
  const messageListener = (
    raw: SyncEventLike | MessageEventLike | ExtendableEventLike,
  ) => {
    const event = raw as MessageEventLike;
    const request = wakeRequest(event.data);
    if (!request) return;
    const result = runNow().then(
      (value) => {
        event.source?.postMessage({
          type: OPTO_SYNC_RESULT_MESSAGE,
          requestId: request.requestId,
          ok: true,
          value,
        });
      },
      (error) => {
        event.source?.postMessage({
          type: OPTO_SYNC_RESULT_MESSAGE,
          requestId: request.requestId,
          ok: false,
          error:
            error instanceof Error
              ? error.message.slice(0, 200)
              : String(error).slice(0, 200),
        });
      },
    );
    event.waitUntil(result);
  };
  const activateListener = (event: ExtendableEventLike) => {
    if (options.runOnActivate) event.waitUntil(runNow());
  };

  options.scope.addEventListener('sync', syncListener);
  options.scope.addEventListener('periodicsync', syncListener);
  options.scope.addEventListener('message', messageListener);
  options.scope.addEventListener('activate', activateListener);

  return {
    runNow,
    close() {
      if (closed) return;
      closed = true;
      activeController?.abort(abortError('service-worker sync controller closed'));
      options.scope.removeEventListener('sync', syncListener);
      options.scope.removeEventListener('periodicsync', syncListener);
      options.scope.removeEventListener('message', messageListener);
      options.scope.removeEventListener('activate', activateListener);
    },
  };
}

export interface ServiceWorkerRegistrationLike {
  sync?: { register(tag: string): Promise<void> };
  active?: { postMessage(value: unknown): void } | null;
  waiting?: { postMessage(value: unknown): void } | null;
  installing?: { postMessage(value: unknown): void } | null;
}

/**
 * Wake the installed worker after a durable local commit. Native Background
 * Sync is preferred; message delivery is the explicit fallback.
 */
export async function registerOptoSyncBackgroundWake(
  registration: ServiceWorkerRegistrationLike,
  tag = OPTO_SYNC_BACKGROUND_TAG,
): Promise<'background-sync' | 'message'> {
  if (registration.sync) {
    await registration.sync.register(tag);
    return 'background-sync';
  }
  const target =
    registration.active ?? registration.waiting ?? registration.installing;
  if (!target) {
    throw new Error('no service worker is available for opto-sync wake-up');
  }
  target.postMessage({ type: OPTO_SYNC_WAKE_MESSAGE });
  return 'message';
}

export function createServiceWorkerMutationTrigger(
  getRegistration: () => Promise<ServiceWorkerRegistrationLike>,
  tag = OPTO_SYNC_BACKGROUND_TAG,
): () => void {
  return () => {
    void getRegistration()
      .then((registration) =>
        registerOptoSyncBackgroundWake(registration, tag),
      )
      .catch(() => {
        // The queue commit is already durable. Connectivity/visibility/manual
        // hints provide another chance, so a wake failure cannot fail the write.
      });
  };
}
