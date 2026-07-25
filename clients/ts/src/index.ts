/**
 * @opto-sync/client — offline-first sync client.
 *
 * - Pure reconcile path (no browser storage needed): see ./reconcile
 * - Dexie-backed optimistic mutation queue: OptoSyncClient / OptoSyncDatabase
 */
import Dexie, { Table } from 'dexie';
import {
  ReconcileOptions,
  JsonRecord,
  reconcileIncoming,
  resolveReconcileOptions,
} from './reconcile';

export {
  ArrayStrategy,
  DEFAULT_RECONCILE_OPTIONS,
  engineVersion,
  reconcileIncoming,
  resolveReconcileOptions,
} from './reconcile';
export type { ReconcileOptions, JsonRecord, MergeOptions } from './reconcile';

// Define the schema for the optimistic local mutations queue
export interface LocalMutation {
  id?: number;
  tableName: string;
  recordId: string;
  jsonPayload: string;
  createdAt: number;
  syncStatus: number; // 0 = pending, 1 = synced, 2 = failed
}

export const SYNC_STATUS = Object.freeze({
  PENDING: 0,
  SYNCED: 1,
  FAILED: 2,
});

export class OptoSyncDatabase extends Dexie {
  localMutations!: Table<LocalMutation, number>;

  constructor(name = 'OptoSyncDatabase') {
    super(name);
    this.version(1).stores({
      localMutations: '++id, tableName, recordId, syncStatus',
    });
  }
}

export type OptoSyncClientOptions = ReconcileOptions & {
  /** Name of the underlying IndexedDB database. */
  databaseName?: string;
};

export class OptoSyncClient {
  public db: OptoSyncDatabase;
  private options: ReconcileOptions;

  constructor(options?: OptoSyncClientOptions) {
    const { databaseName, ...reconcileOptions } = options ?? {};
    this.db = new OptoSyncDatabase(databaseName);
    this.options = resolveReconcileOptions(reconcileOptions);
  }

  /**
   * Queue an optimistic local write.
   */
  async queueMutation(tableName: string, recordId: string, payload: JsonRecord): Promise<number> {
    const id = await this.db.localMutations.add({
      tableName,
      recordId,
      jsonPayload: JSON.stringify(payload),
      createdAt: Date.now(),
      syncStatus: SYNC_STATUS.PENDING,
    });

    this.triggerBackgroundSync();
    return id;
  }

  /** All queued mutations still waiting to be pushed to the server. */
  async pendingMutations(tableName?: string): Promise<LocalMutation[]> {
    let mutations = await this.db.localMutations
      .where('syncStatus')
      .equals(SYNC_STATUS.PENDING)
      .toArray();
    if (tableName !== undefined) {
      mutations = mutations.filter((m) => m.tableName === tableName);
    }
    return mutations;
  }

  /** Mark a queued mutation as synced (or failed). */
  async markMutation(id: number, syncStatus: number): Promise<void> {
    await this.db.localMutations.update(id, { syncStatus });
  }

  /**
   * Process an incoming payload from the server against the local copy.
   * Pure: no storage is touched — the caller persists the returned merge.
   */
  reconcileIncoming(
    _tableName: string,
    _recordId: string,
    incomingPayload: JsonRecord,
    existingLocalPayload: JsonRecord,
    overrides?: ReconcileOptions,
  ): JsonRecord {
    return reconcileIncoming(existingLocalPayload, incomingPayload, {
      ...this.options,
      ...overrides,
    });
  }

  private triggerBackgroundSync() {
    // Implement background job to send pending mutations to the server.
  }
}
