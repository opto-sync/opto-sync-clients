/**
 * Connectivity-aware opto-sync client.
 *
 * This wrapper preserves the ordinary durable queue and reconciliation APIs,
 * then emits data-only save events after a queue transaction commits. It never
 * renders UI and never treats a listener or wake callback as a durability
 * boundary.
 */
import type { Table } from 'dexie';
import {
  OptoSyncClient,
  type AtomicOptimisticWriter,
  type OptoSyncClientOptions,
} from './client.js';
import type { ProtocolMutationOptions } from './protocol.js';
import type { JsonRecord } from './reconcile-core.js';
import {
  createDefaultConnectivityWatcher,
  type BrowserConnectivityWatcherOptions,
  type ConnectivityListener,
  type ConnectivitySnapshot,
  type ConnectivitySubscribeOptions,
  type ConnectivityWatcher,
} from './connectivity.js';

export type LocalSaveOperation = 'upsert' | 'delete';

/** Metadata only. Mutation payloads and credentials are never exposed. */
export interface LocalSaveEvent {
  readonly queueId: number;
  readonly tableName: string;
  readonly recordId: string;
  readonly operation: LocalSaveOperation;
  readonly savedAt: number;
  readonly connectivity: ConnectivitySnapshot;
}

export type LocalSaveListener = (
  event: LocalSaveEvent,
) => void | Promise<void>;

export interface SaveSubscribeOptions {
  /** Deliver only saves made with verified internet reachability. */
  onlineOnly?: boolean;
}

export type ConnectivityAwareOptoSyncClientOptions = Omit<
  OptoSyncClientOptions,
  'onMutationQueued'
> & {
  /** Existing post-commit sync-loop wake hint. Suppressed in total-offline mode. */
  onMutationQueued?: () => void;
  connectivity?: ConnectivityWatcher;
  /** Used only when connectivity is omitted. */
  browserConnectivity?: Omit<BrowserConnectivityWatcherOptions, 'host'>;
  /** Start the watcher during construction. Default true. */
  autoStartConnectivity?: boolean;
  /** Stop the watcher from dispose. Defaults to true for an internally-created watcher. */
  stopConnectivityOnDispose?: boolean;
  /** Called after every durable local upsert/delete. */
  onSave?: LocalSaveListener;
  /** Called only when a durable save observes verified internet reachability. */
  onOnlineSave?: LocalSaveListener;
};

type RegisteredSaveListener = Readonly<{
  listener: LocalSaveListener;
  onlineOnly: boolean;
}>;

function callBestEffort<T>(
  callback: ((value: T) => void | Promise<void>) | undefined,
  value: T,
): void {
  if (!callback) return;
  try {
    const result = callback(value);
    if (result && typeof (result as PromiseLike<void>).then === 'function') {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // The queue transaction already committed. Observer failures are isolated
    // so callers never see a false "save failed" result.
  }
}

function callWakeHint(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    const result = (callback as () => unknown)();
    if (
      result !== null &&
      result !== undefined &&
      typeof (result as PromiseLike<void>).then === 'function'
    ) {
      void Promise.resolve(result as PromiseLike<void>).catch(
        () => undefined,
      );
    }
  } catch {
    // Wakes are hints. A periodic/foreground drain will deliver later.
  }
}

/**
 * Drop-in OptoSyncClient subclass with connectivity listeners and post-save
 * signals. The inherited queue methods retain their existing signatures.
 */
export class ConnectivityAwareOptoSyncClient extends OptoSyncClient {
  public readonly connectivity: ConnectivityWatcher;

  private readonly ownsConnectivity: boolean;
  private readonly stopConnectivityOnDispose: boolean;
  private readonly onSave?: LocalSaveListener;
  private readonly onOnlineSave?: LocalSaveListener;
  private readonly saveListeners = new Set<RegisteredSaveListener>();
  private backgroundSyncHint?: () => void;
  private unsubscribeConnectivity?: () => void;
  private disposed = false;

  constructor(options: ConnectivityAwareOptoSyncClientOptions = {}) {
    const {
      connectivity,
      browserConnectivity,
      autoStartConnectivity = true,
      stopConnectivityOnDispose,
      onSave,
      onOnlineSave,
      onMutationQueued,
      ...clientOptions
    } = options;

    // Do not install the base class's unconditional wake callback. This class
    // invokes the same callback after commit only when total-offline mode does
    // not veto network-bound work.
    super(clientOptions);

    this.ownsConnectivity = connectivity === undefined;
    this.connectivity =
      connectivity ?? createDefaultConnectivityWatcher(browserConnectivity);
    this.stopConnectivityOnDispose =
      stopConnectivityOnDispose ?? this.ownsConnectivity;
    this.onSave = onSave;
    this.onOnlineSave = onOnlineSave;
    this.backgroundSyncHint = onMutationQueued;

    this.unsubscribeConnectivity = this.connectivity.subscribe(
      (next, previous) => {
        if (
          next.mode === 'automatic' &&
          next.state === 'internet' &&
          (previous.mode !== 'automatic' || previous.state !== 'internet')
        ) {
          callWakeHint(this.backgroundSyncHint);
        }
      },
      { emitCurrent: false },
    );

    if (autoStartConnectivity) this.connectivity.start();
  }

  override async queueMutation(
    tableName: string,
    recordId: string,
    payload: JsonRecord,
    protocol: ProtocolMutationOptions = {},
  ): Promise<number> {
    const queueId = await super.queueMutation(
      tableName,
      recordId,
      payload,
      protocol,
    );
    this.afterDurableSave(queueId, tableName, recordId, 'upsert');
    return queueId;
  }

  override async queueMutationAtomic(
    tableName: string,
    recordId: string,
    payload: JsonRecord,
    authoritativeTables: readonly Table[],
    applyOptimistic: AtomicOptimisticWriter,
    protocol: ProtocolMutationOptions = {},
  ): Promise<number> {
    const queueId = await super.queueMutationAtomic(
      tableName,
      recordId,
      payload,
      authoritativeTables,
      applyOptimistic,
      protocol,
    );
    this.afterDurableSave(queueId, tableName, recordId, 'upsert');
    return queueId;
  }

  override async queueDelete(
    tableName: string,
    recordId: string,
    options: Pick<ProtocolMutationOptions, 'baseRevision'> = {},
  ): Promise<number> {
    const queueId = await super.queueDelete(tableName, recordId, options);
    this.afterDurableSave(queueId, tableName, recordId, 'delete');
    return queueId;
  }

  override async queueDeleteAtomic(
    tableName: string,
    recordId: string,
    authoritativeTables: readonly Table[],
    applyOptimisticDelete: () => void | Promise<void>,
    options: Pick<ProtocolMutationOptions, 'baseRevision'> = {},
  ): Promise<number> {
    const queueId = await super.queueDeleteAtomic(
      tableName,
      recordId,
      authoritativeTables,
      applyOptimisticDelete,
      options,
    );
    this.afterDurableSave(queueId, tableName, recordId, 'delete');
    return queueId;
  }

  /** Attach or replace the post-commit sync-loop wake hint. */
  override setBackgroundSyncTrigger(trigger?: () => void): void {
    this.backgroundSyncHint = trigger;
  }

  connectivitySnapshot(): ConnectivitySnapshot {
    return this.connectivity.snapshot();
  }

  subscribeConnectivity(
    listener: ConnectivityListener,
    options?: ConnectivitySubscribeOptions,
  ): () => void {
    return this.connectivity.subscribe(listener, options);
  }

  subscribeSave(
    listener: LocalSaveListener,
    options: SaveSubscribeOptions = {},
  ): () => void {
    const registration = Object.freeze({
      listener,
      onlineOnly: options.onlineOnly === true,
    });
    this.saveListeners.add(registration);
    return () => {
      this.saveListeners.delete(registration);
    };
  }

  setTotalOffline(enabled: boolean): void {
    this.connectivity.setMode(enabled ? 'offline' : 'automatic');
  }

  async refreshConnectivity(): Promise<ConnectivitySnapshot> {
    return this.connectivity.refresh
      ? this.connectivity.refresh()
      : this.connectivity.snapshot();
  }

  /** Release listeners; database lifetime remains owned by the caller. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeConnectivity?.();
    this.unsubscribeConnectivity = undefined;
    this.saveListeners.clear();
    if (this.stopConnectivityOnDispose) this.connectivity.stop();
  }

  private afterDurableSave(
    queueId: number,
    tableName: string,
    recordId: string,
    operation: LocalSaveOperation,
  ): void {
    const connectivity = this.connectivity.snapshot();
    const event: LocalSaveEvent = Object.freeze({
      queueId,
      tableName,
      recordId,
      operation,
      savedAt: Date.now(),
      connectivity,
    });

    callBestEffort(this.onSave, event);
    for (const registration of [...this.saveListeners]) {
      if (
        registration.onlineOnly &&
        !(
          connectivity.mode === 'automatic' &&
          connectivity.state === 'internet'
        )
      ) {
        continue;
      }
      callBestEffort(registration.listener, event);
    }

    if (
      connectivity.mode === 'automatic' &&
      connectivity.state === 'internet'
    ) {
      callBestEffort(this.onOnlineSave, event);
    }

    if (
      connectivity.mode === 'automatic' &&
      connectivity.state !== 'offline'
    ) {
      callWakeHint(this.backgroundSyncHint);
    }
  }
}
