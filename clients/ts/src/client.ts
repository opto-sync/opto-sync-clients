/**
 * The Dexie-backed optimistic mutation queue.
 *
 * Engine-agnostic on purpose: this file imports ./reconcile-core, never a merge
 * engine, so the identical class works in Node (native engine) and in a browser
 * tab against real IndexedDB (wasm engine). The entry points decide which
 * engine is installed; see ./engine.ts.
 */
import Dexie, { Table } from 'dexie';
import {
  ReconcileOptions,
  JsonRecord,
  reconcileIncoming,
  resolveReconcileOptions,
} from './reconcile-core.js';
import { HybridLogicalClock, HlcPersistence, randomNodeId } from './clock.js';

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

/** Key/value row for clock state and the client's node id. */
export interface MetaRow {
  key: string;
  value: string;
}

export class OptoSyncDatabase extends Dexie {
  localMutations!: Table<LocalMutation, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'OptoSyncDatabase') {
    super(name);
    // v1 shipped without `meta`. Declaring both versions lets Dexie upgrade an
    // existing database in place, so queued mutations survive the migration —
    // dropping them would silently discard a user's un-synced work.
    this.version(1).stores({
      localMutations: '++id, tableName, recordId, syncStatus',
    });
    this.version(2).stores({
      localMutations: '++id, tableName, recordId, syncStatus',
      meta: '&key',
    });
  }
}

const META_NODE_ID = 'hlc.nodeId';
const META_CLOCK = 'hlc.last';

export type OptoSyncClientOptions = ReconcileOptions & {
  /** Name of the underlying IndexedDB database. */
  databaseName?: string;
  /**
   * Stamp `updatedAt` with the hybrid logical clock when a queued payload does
   * not carry one. Default true. Set false only if your server stamps an
   * authoritative time and your app never resolves conflicts locally.
   */
  stampUpdatedAt?: boolean;
};

export class OptoSyncClient {
  public db: OptoSyncDatabase;
  private options: ReconcileOptions;
  private clockPromise?: Promise<HybridLogicalClock>;
  private readonly stampUpdatedAt: boolean;

  constructor(options?: OptoSyncClientOptions) {
    const { databaseName, stampUpdatedAt, ...reconcileOptions } = options ?? {};
    this.db = new OptoSyncDatabase(databaseName);
    this.options = resolveReconcileOptions(reconcileOptions);
    this.stampUpdatedAt = stampUpdatedAt !== false;
  }

  /**
   * The client's hybrid logical clock, created on first use and backed by the
   * `meta` store so it cannot go backwards across a reload. The node id is
   * generated once per install and persisted — regenerating it would break tie
   * ordering against this client's own past writes.
   */
  clock(): Promise<HybridLogicalClock> {
    if (!this.clockPromise) {
      this.clockPromise = (async () => {
        let nodeId = (await this.db.meta.get(META_NODE_ID))?.value;
        if (!nodeId) {
          nodeId = randomNodeId();
          await this.db.meta.put({ key: META_NODE_ID, value: nodeId });
        }
        const persistence: HlcPersistence = {
          load: async () => (await this.db.meta.get(META_CLOCK))?.value ?? null,
          save: async (ts) => {
            await this.db.meta.put({ key: META_CLOCK, value: ts });
          },
        };
        const hlc = new HybridLogicalClock({ nodeId, persistence });
        await hlc.restore();
        return hlc;
      })();
    }
    return this.clockPromise;
  }

  /**
   * Advance the clock past timestamps in a payload received from elsewhere, so
   * this client's next write is ordered after what it has already seen. Call
   * this when pulling server state; `reconcileIncoming` stays pure and
   * synchronous and therefore cannot do it itself.
   */
  async observeIncoming(payload: JsonRecord): Promise<void> {
    const clock = await this.clock();
    const keys = String(this.options.lwwKeys ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    const walk = async (node: unknown): Promise<void> => {
      if (Array.isArray(node)) {
        for (const item of node) await walk(item);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'string') await clock.observe(v);
      }
      for (const v of Object.values(obj)) await walk(v);
    };
    await walk(payload);
  }

  /**
   * Queue an optimistic local write.
   */
  async queueMutation(tableName: string, recordId: string, payload: JsonRecord): Promise<number> {
    // Stamp `updatedAt` with the HLC unless the caller supplied one. Without a
    // logically-ordered timestamp the engine's last-write-wins is decided by
    // device clock skew: a device running fast wins every conflict forever, and
    // a clock that steps backwards makes its own edits vanish. `createdAt` is
    // deliberately NOT stamped — it is first-write-wins and belongs to whoever
    // created the record.
    let stamped = payload;
    if (this.stampUpdatedAt && payload.updatedAt === undefined) {
      const clock = await this.clock();
      stamped = { ...payload, updatedAt: await clock.next() };
    }

    const id = await this.db.localMutations.add({
      tableName,
      recordId,
      jsonPayload: JSON.stringify(stamped),
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
   *
   * Synchronous, on every platform. In a browser this requires that
   * `await initOptoSync()` (or the createOptoSyncClient() factory) has already
   * run; it throws a descriptive error otherwise rather than reconciling with
   * no engine.
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
