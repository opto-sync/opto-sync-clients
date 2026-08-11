/**
 * @opto-sync/client — offline-first sync client. **Node entry point.**
 *
 * Importing this module installs the native @opto-sync/syncer engine, so
 * everything here is ready to use synchronously with no init step.
 *
 * Browsers resolve "@opto-sync/client" to ./browser instead (via the `browser`
 * condition in package.json `exports`), which uses the WebAssembly engine and
 * needs one `await initOptoSync()`. Bundlers pick that automatically; the
 * exported surface is otherwise identical.
 *
 * - Pure reconcile path (no browser storage needed): see ./reconcile
 * - Dexie-backed optimistic mutation queue: OptoSyncClient / OptoSyncDatabase
 */

/* Side effect: installs the native merge engine. Must precede any reconcile. */
import './reconcile.js';

/*
 * NAMESPACED SURFACE — the recommended import style for wrapper libraries
 * (fiducia-sync, daedalus-sync, athleto-sync, quaestor-sync, …) that re-export
 * a curated slice of opto-sync: namespaces cannot collide with the wrapper's
 * own names, and `export * from` wildcard clashes are impossible.
 */
export * as reconcile from './reconcile.js';
export * as queue from './client.js';
export * as clock from './clock.js';
export * as protocol from './protocol.js';
export * as syncLoop from './sync-loop.js';
export * as transports from './transport/ws.js';
export * as crossTab from './cross-tab.js';
export * as backgroundSync from './register-sw.js';
export * as connectivity from './connectivity.js';
export * as connectedClient from './connected-client.js';
export * as rx from './rx/index.js';
export * as schema from './schema/ingest.js';
export * as telemetry from './telemetry.js';

/*
 * CURATED TOP-LEVEL NAMES — the everyday API, re-exported once each (never
 * via `export *`, so any future name clash is a compile error here instead of
 * a silent shadowing in consumers).
 */
export {
  ArrayStrategy,
  DEFAULT_RECONCILE_OPTIONS,
  reconcileIncoming,
  rebasePending,
  resolveReconcileOptions,
  setMergeEngine,
  hasMergeEngine,
  getMergeEngine,
  resetMergeEngine,
  engineVersion,
  mergeEngineKind,
} from './reconcile.js';
export type {
  JsonRecord,
  ReconcileOptions,
  RebaseOptions,
  MergeOptions,
  MergeEngine,
  MergeEngineKind,
} from './reconcile.js';
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
export {
  BrowserConnectivityWatcher,
  ManualConnectivityWatcher,
  createDefaultConnectivityWatcher,
} from './connectivity.js';
export type {
  BrowserConnectivityHost,
  BrowserConnectivityWatcherOptions,
  ConnectivityListener,
  ConnectivityMode,
  ConnectivitySnapshot,
  ConnectivitySource,
  ConnectivityState,
  ConnectivitySubscribeOptions,
  ConnectivityWatcher,
  ManualConnectivityWatcherOptions,
} from './connectivity.js';
export { ConnectivityAwareOptoSyncClient } from './connected-client.js';
export type {
  ConnectivityAwareOptoSyncClientOptions,
  LocalSaveEvent,
  LocalSaveListener,
  LocalSaveOperation,
  SaveSubscribeOptions,
} from './connected-client.js';
export {
  TELEMETRY_SCHEMA_VERSION,
  createTelemetryEvent,
  emitTelemetry,
  observeSyncCycle,
} from './telemetry.js';
export type {
  TelemetryEvent,
  TelemetryFields,
  TelemetryLevel,
  TelemetrySink,
} from './telemetry.js';
