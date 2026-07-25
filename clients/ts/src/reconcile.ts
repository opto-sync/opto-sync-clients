/**
 * Node reconcile entry point: the pure reconcile API, wired to the native
 * @opto-sync/syncer addon.
 *
 * Importing this module installs the native engine as a side effect, so
 * reconcileIncoming() is usable immediately and synchronously — no init step,
 * exactly as before the engine became swappable. Server code, scripts and the
 * test suite import this.
 *
 * A browser must NOT import this file: the native addon is a .node binary and
 * no bundler can do anything with it. Use "@opto-sync/client/browser" there;
 * both re-export the identical reconcile API from ./reconcile-core.
 */
import nativeSyncer from '@opto-sync/syncer';
import { setMergeEngine } from './engine.js';

/* Registered at import time, before any consumer of this module can call
   reconcileIncoming(). Idempotent by construction: re-importing a module does
   not re-run it. */
setMergeEngine(
  {
    mergeJson: (base, incoming, options) => nativeSyncer.mergeJson(base, incoming, options),
    version: () => nativeSyncer.version(),
  },
  'native',
);

export * from './reconcile-core.js';
