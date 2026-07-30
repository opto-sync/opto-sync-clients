/**
 * @opto-sync/client — **browser entry point.**
 *
 * Same client, same reconcile semantics, but the merge engine is
 * @opto-sync/syncer-wasm instead of the native N-API addon, so this file (and
 * everything it imports) is bundleable and contains no Node builtins.
 *
 * Bundlers reach this automatically through the `browser` condition in
 * package.json `exports`; you can also import it explicitly as
 * "@opto-sync/client/browser".
 *
 * ERGONOMICS
 * ----------
 * wasm instantiation is inherently asynchronous, but making every reconcile
 * async would be a bad trade: reconcile is called once per incoming record, is
 * pure and CPU-bound, and callers frequently want it inside a Dexie
 * transaction where an unnecessary await is a chance to lose atomicity. So the
 * asynchrony is paid exactly once, up front:
 *
 *     import { initOptoSync, OptoSyncClient } from '@opto-sync/client';
 *
 *     await initOptoSync();                 // once, at app startup
 *     const client = new OptoSyncClient();
 *     client.reconcileIncoming(...);        // synchronous, like Node
 *
 * or, if you prefer not to have a separate startup step:
 *
 *     const client = await createOptoSyncClient({ databaseName: 'app' });
 *
 * `initOptoSync()` is idempotent and concurrency-safe, so calling it at the top
 * of several independent entry points is fine and instantiates wasm once.
 * Forgetting it does not silently misbehave: reconcileIncoming() throws with an
 * explanatory message.
 */
import { setMergeEngine, hasMergeEngine } from './engine.js';
import { OptoSyncClient, OptoSyncClientOptions } from './client.js';

/* Namespaced surface (recommended for wrapper libraries; clash-proof). */
export * as reconcile from './reconcile-core.js';
export * as engine from './engine.js';
export * as queue from './client.js';
export * as clock from './clock.js';
export * as protocol from './protocol.js';
export * as syncLoop from './sync-loop.js';
export * as transports from './transport/ws.js';
export * as crossTab from './cross-tab.js';
export * as backgroundSync from './register-sw.js';
export * as rx from './rx/index.js';

/* Curated top-level names — one explicit re-export each, never `export *`. */
export {
  ArrayStrategy,
  DEFAULT_RECONCILE_OPTIONS,
  reconcileIncoming,
  rebasePending,
  resolveReconcileOptions,
  engineVersion,
} from './reconcile-core.js';
export type {
  JsonRecord,
  ReconcileOptions,
  RebaseOptions,
  MergeOptions,
} from './reconcile-core.js';
export {
  setMergeEngine,
  hasMergeEngine,
  getMergeEngine,
  resetMergeEngine,
  mergeEngineKind,
} from './engine.js';
export type { MergeEngine, MergeEngineKind } from './engine.js';
export {
  OptoSyncClient,
  OptoSyncDatabase,
  QueueQuotaError,
  SYNC_STATUS,
  DEFAULT_MAX_PENDING_MUTATIONS,
  DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
} from './client.js';
export type {
  OptoSyncClientOptions,
  LocalMutation,
  MetaRow,
  AtomicOptimisticWriter,
} from './client.js';
export {
  HybridLogicalClock,
  ClockDriftError,
  DEFAULT_MAX_DRIFT_MS,
  randomNodeId,
  composeNodeId,
  formatHlc,
  parseHlc,
  compareHlc,
} from './clock.js';
export type {
  HlcParts,
  HlcPersistence,
  HybridLogicalClockOptions,
} from './clock.js';
export { buildPushRequest, validatePushResponse } from './protocol.js';
export type {
  ProtocolMutationOptions,
  PushMutation,
  PushRequest,
  PushResponse,
  MutationResult,
  PullResponse,
  Change,
  SnapshotRecord,
  SnapshotResponse,
} from './protocol.js';
export {
  ProtocolSyncLoop,
  SyncTransportError,
  computeRetryDelay,
} from './sync-loop.js';
export type {
  ProtocolTransport,
  ProtocolQueueAdapter,
  ProtocolSyncCallbacks,
  ProtocolSyncState,
  ProtocolSyncStatus,
  ProtocolSyncCycleResult,
  ProtocolSyncLoopOptions,
  ResetRequired,
} from './sync-loop.js';
export { WebSocketTransport } from './transport/ws.js';
export type {
  WebSocketTransportOptions,
  AuthTokenProvider,
  WebSocketLike,
} from './transport/ws.js';
export { startCrossTabCoordinator } from './cross-tab.js';
export type {
  CrossTabCoordinator,
  CrossTabCoordinatorOptions,
} from './cross-tab.js';
export { registerBackgroundSync } from './register-sw.js';
export type {
  BackgroundSyncHandle,
  BackgroundSyncStrategy,
  RegisterBackgroundSyncOptions,
} from './register-sw.js';

/** Options forwarded to the wasm engine's own initializer. */
export interface InitOptoSyncOptions {
  /**
   * Pre-fetched wasm bytes. Only needed for exotic hosts that cannot fetch
   * their own assets — the default engine build has the wasm inlined, so the
   * common case needs nothing here.
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Override where a split wasm build looks for syncer-core.wasm. */
  locateFile?: (path: string, scriptDirectory: string) => string;
}

let initPromise: Promise<void> | null = null;

/**
 * Instantiate the WebAssembly merge engine and install it.
 *
 * Idempotent: repeated and concurrent calls share one instantiation. A failure
 * is not cached, so it can be retried.
 */
export function initOptoSync(options?: InitOptoSyncOptions): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const wasm = await import('@opto-sync/syncer-wasm');
      await wasm.initSyncer(options);
      setMergeEngine(
        {
          mergeJson: (base, incoming, opts) => wasm.mergeJson(base, incoming, opts),
          version: () => wasm.version(),
        },
        'wasm',
      );
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** True once the wasm engine is installed and reconciling is safe. */
export function isOptoSyncReady(): boolean {
  return hasMergeEngine();
}

/**
 * Async factory: initialize the engine (if needed) and hand back a client.
 * Equivalent to `await initOptoSync(); new OptoSyncClient(options)`.
 */
export async function createOptoSyncClient(
  options?: OptoSyncClientOptions & { init?: InitOptoSyncOptions },
): Promise<OptoSyncClient> {
  const { init, ...clientOptions } = options ?? {};
  await initOptoSync(init);
  return new OptoSyncClient(clientOptions);
}
