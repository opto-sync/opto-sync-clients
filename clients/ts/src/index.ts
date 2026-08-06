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
export * from './reconcile.js';
export * from './client.js';
export * from './clock.js';
export * from './protocol.js';
export * from './sync-loop.js';
export * from './http-transport.js';
export * from './reactive.js';
export * from './service-worker.js';
export * from './session.js';
export * from './cross-context.js';
export * from './ingest.js';
