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
  RebaseOptions,
  JsonRecord,
  reconcileIncoming,
  rebasePending,
  resolveReconcileOptions,
} from './reconcile-core.js';
import {
  HybridLogicalClock,
  HlcPersistence,
  randomNodeId,
  composeNodeId,
} from './clock.js';
import {
  buildPushRequest,
  ProtocolMutationOptions,
  PushRequest,
  PushResponse,
  SnapshotRecord,
  SnapshotResponse,
  validatePushResponse,
} from './protocol.js';

// Define the schema for the optimistic local mutations queue
export interface LocalMutation {
  id?: number;
  tableName: string;
  recordId: string;
  jsonPayload: string;
  createdAt: number;
  syncStatus: number; // 0 = pending, 1 = synced, 2 = failed
  /**
   * Stable identity of the client that authored this mutation. Paired with
   * `mutationId` it is what lets a server dedupe a replay.
   */
  clientId?: string;
  /**
   * Per-client monotonic sequence number. Push is at-least-once — a request
   * that times out may still have been applied — so the server records the
   * highest `mutationId` it has seen per client and ignores anything at or
   * below it. Without this, a retry after an ambiguous failure double-applies.
   */
  mutationId?: string;
  /** Protocol operation. Older queue rows are interpreted as `upsert`. */
  operation?: 'upsert' | 'delete';
  /** Authoritative revision this mutation was based on. */
  baseRevision?: string;
  /** Explicitly permit recreating a tombstoned record at baseRevision. */
  resurrect?: boolean;
  /** Push attempts so far. Drives backoff and makes a stuck row diagnosable. */
  attempts?: number;
  /** Last push error, for diagnosis. Never contains the payload. */
  lastError?: string;
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
    // v3 adds mutation identity. Rows queued under v1/v2 have no clientId or
    // mutationId; they are still pushed, just without dedupe protection, which
    // is no worse than before. Declaring the version rather than recreating the
    // table keeps un-synced work.
    this.version(3).stores({
      localMutations:
        '++id, tableName, recordId, syncStatus, [tableName+recordId]',
      meta: '&key',
    });
  }
}

const META_NODE_ID = 'hlc.nodeId';
const META_CLOCK = 'hlc.last';
const META_MUTATION_SEQ = 'mutation.seq';
const META_PULL_CHECKPOINT = 'pull.checkpoint';
export const DEFAULT_MAX_PENDING_MUTATIONS = 10_000;
export const DEFAULT_MAX_QUEUED_PAYLOAD_BYTES = 255 * 1024;

export class QueueQuotaError extends Error {
  readonly code: 'QUEUE_FULL' | 'PAYLOAD_TOO_LARGE';

  constructor(code: 'QUEUE_FULL' | 'PAYLOAD_TOO_LARGE', message: string) {
    super(message);
    this.name = 'QueueQuotaError';
    this.code = code;
  }
}

export type OptoSyncClientOptions = ReconcileOptions & {
  /** Name of the underlying IndexedDB database. */
  databaseName?: string;
  /**
   * Stamp `updatedAt` with the hybrid logical clock when a queued payload does
   * not carry one. Default true. Set false only if your server stamps an
   * authoritative time and your app never resolves conflicts locally.
   */
  stampUpdatedAt?: boolean;
  /** Maximum unacknowledged rows in this IndexedDB queue. Default 10,000. */
  maxPendingMutations?: number;
  /**
   * Maximum UTF-8 bytes in one queued JSON payload. Default 255 KiB, leaving
   * room inside the reference server's 256 KiB mutation-envelope limit.
   */
  maxQueuedPayloadBytes?: number;
  /** Optional wake-up hook invoked after a durable queue commit. */
  onMutationQueued?: () => void;
};

/**
 * Application write performed inside the same IndexedDB transaction as its
 * queue entry. Every table touched by the callback must be passed to
 * `queueMutationAtomic`; IndexedDB cannot add stores after a transaction starts.
 */
export type AtomicOptimisticWriter = (
  stampedPayload: Readonly<JsonRecord>,
) => void | Promise<void>;

export type QueueBatchMutation =
  | {
      operation: 'upsert';
      tableName: string;
      recordId: string;
      payload: JsonRecord;
      baseRevision?: string;
      resurrect?: boolean;
    }
  | {
      operation: 'delete';
      tableName: string;
      recordId: string;
      baseRevision?: string;
    };

/**
 * Resolve a timestamp selector against one candidate merge node.
 *
 * Plain selectors are direct keys. `#/...` selectors use RFC 6901 JSON Pointer
 * syntax relative to the node, matching syncer.c's timestamp policy contract.
 */
function timestampSelectorValue(node: unknown, selector: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  if (!selector.startsWith('#/')) {
    return (node as Record<string, unknown>)[selector];
  }

  let current: unknown = node;
  for (const encoded of selector.slice(2).split('/')) {
    // RFC 6901 permits only ~0 and ~1 escapes. Refuse malformed selectors so
    // clock observation cannot disagree with the C core's pointer resolver.
    if (/~(?:[^01]|$)/.test(encoded)) return undefined;
    const token = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return undefined;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length)
        return undefined;
      current = current[index];
    } else if (current && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, token))
        return undefined;
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

export class OptoSyncClient {
  public db: OptoSyncDatabase;
  private options: ReconcileOptions;
  private clockPromise?: Promise<HybridLogicalClock>;
  private readonly stampUpdatedAt: boolean;
  private readonly maxPendingMutations: number;
  private readonly maxQueuedPayloadBytes: number;
  private backgroundSyncTrigger?: () => void;

  constructor(options?: OptoSyncClientOptions) {
    const {
      databaseName,
      stampUpdatedAt,
      maxPendingMutations = DEFAULT_MAX_PENDING_MUTATIONS,
      maxQueuedPayloadBytes = DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
      onMutationQueued,
      ...reconcileOptions
    } = options ?? {};
    if (!Number.isSafeInteger(maxPendingMutations) || maxPendingMutations < 1) {
      throw new RangeError('maxPendingMutations must be a positive safe integer');
    }
    if (
      !Number.isSafeInteger(maxQueuedPayloadBytes) ||
      maxQueuedPayloadBytes < 2
    ) {
      throw new RangeError(
        'maxQueuedPayloadBytes must be a safe integer of at least 2',
      );
    }
    this.db = new OptoSyncDatabase(databaseName);
    this.options = resolveReconcileOptions(reconcileOptions);
    this.stampUpdatedAt = stampUpdatedAt !== false;
    this.maxPendingMutations = maxPendingMutations;
    this.maxQueuedPayloadBytes = maxQueuedPayloadBytes;
    this.backgroundSyncTrigger = onMutationQueued;
  }

  private assertPayloadQuota(jsonPayload: string): void {
    const bytes = new TextEncoder().encode(jsonPayload).byteLength;
    if (bytes > this.maxQueuedPayloadBytes) {
      throw new QueueQuotaError(
        'PAYLOAD_TOO_LARGE',
        `queued payload is ${bytes} bytes; limit is ${this.maxQueuedPayloadBytes}`,
      );
    }
  }

  private async assertPendingQuota(): Promise<void> {
    const pending = await this.db.localMutations
      .where('syncStatus')
      .equals(SYNC_STATUS.PENDING)
      .count();
    if (pending >= this.maxPendingMutations) {
      throw new QueueQuotaError(
        'QUEUE_FULL',
        `pending queue has reached its ${this.maxPendingMutations}-mutation limit`,
      );
    }
  }

  private async assertPendingBatchQuota(additional: number): Promise<void> {
    const pending = await this.db.localMutations
      .where('syncStatus')
      .equals(SYNC_STATUS.PENDING)
      .count();
    if (pending + additional > this.maxPendingMutations) {
      throw new QueueQuotaError(
        'QUEUE_FULL',
        `queue has ${pending} pending mutations; adding ${additional} exceeds its ${this.maxPendingMutations}-mutation limit`,
      );
    }
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
        // The DEVICE id is durable; the node id adds a per-instance suffix.
        // Tabs share one IndexedDB, so a purely persisted node id would let two
        // tabs issue identical timestamps and reintroduce non-convergent ties.
        const deviceId = await this.db.transaction(
          'rw',
          this.db.meta,
          async () => {
            const existing = (await this.db.meta.get(META_NODE_ID))?.value;
            if (existing) return existing;
            const generated = randomNodeId();
            await this.db.meta.put({ key: META_NODE_ID, value: generated });
            return generated;
          },
        );
        const nodeId = composeNodeId(deviceId);
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
    const keys = String(this.options.lwwKeys ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const walk = async (node: unknown): Promise<void> => {
      if (Array.isArray(node)) {
        for (const item of node) await walk(item);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      for (const key of keys) {
        const v = timestampSelectorValue(obj, key);
        if (typeof v === 'string') await clock.observe(v);
      }
      for (const v of Object.values(obj)) await walk(v);
    };
    await walk(payload);
  }

  /**
   * Queue an optimistic local write.
   */
  async queueMutation(
    tableName: string,
    recordId: string,
    payload: JsonRecord,
    protocol: ProtocolMutationOptions = {},
  ): Promise<number> {
    const { jsonPayload, clientId } = await this.prepareUpsert(payload);
    const id = await this.insertPreparedUpsert(
      tableName,
      recordId,
      jsonPayload,
      clientId,
      protocol,
    );
    this.triggerBackgroundSync();
    return id;
  }

  /**
   * Apply an optimistic IndexedDB write and enqueue its mutation atomically.
   *
   * `authoritativeTables` must contain every Dexie table touched by
   * `applyOptimistic`, and all of them must belong to this client's database.
   * If the callback, quota check, sequence allocation, or queue insert fails,
   * IndexedDB rolls the application write and queue state back together.
   */
  async queueMutationAtomic(
    tableName: string,
    recordId: string,
    payload: JsonRecord,
    authoritativeTables: readonly Table[],
    applyOptimistic: AtomicOptimisticWriter,
    protocol: ProtocolMutationOptions = {},
  ): Promise<number> {
    const { jsonPayload, clientId } = await this.prepareUpsert(payload);
    const id = await this.insertPreparedUpsert(
      tableName,
      recordId,
      jsonPayload,
      clientId,
      protocol,
      authoritativeTables,
      applyOptimistic,
    );
    this.triggerBackgroundSync();
    return id;
  }

  private async prepareUpsert(payload: JsonRecord): Promise<{
    jsonPayload: string;
    clientId: string;
  }> {
    // Stamp `updatedAt` with the HLC unless the caller supplied one. Without a
    // logically-ordered timestamp the engine's last-write-wins is decided by
    // device clock skew: a device running fast wins every conflict forever, and
    // a clock that steps backwards makes its own edits vanish. `createdAt` is
    // deliberately NOT stamped: it belongs to whoever created the record, and
    // under an opt-in `fwwKeys` policy a stamped `createdAt` would veto the
    // whole node on the receiving side.
    let stamped = payload;
    if (this.stampUpdatedAt && payload.updatedAt === undefined) {
      const clock = await this.clock();
      stamped = { ...payload, updatedAt: await clock.next() };
    }
    const jsonPayload = JSON.stringify(stamped);
    this.assertPayloadQuota(jsonPayload);
    return { jsonPayload, clientId: await this.clientId() };
  }

  private async insertPreparedUpsert(
    tableName: string,
    recordId: string,
    jsonPayload: string,
    clientId: string,
    protocol: ProtocolMutationOptions,
    authoritativeTables: readonly Table[] = [],
    applyOptimistic?: AtomicOptimisticWriter,
  ): Promise<number> {
    // Allocate the sequence number and enqueue in ONE transaction. Two
    // concurrent queueMutation() calls that each read-then-wrote the counter
    // separately could otherwise hand out the same mutationId, and a server
    // deduping on (clientId, mutationId) would silently drop the second write.
    const { id, mutationId } = await this.db.transaction(
      'rw',
      [this.db.localMutations, this.db.meta, ...authoritativeTables],
      async () => {
        await this.assertPendingQuota();
        const previous = BigInt(
          (await this.db.meta.get(META_MUTATION_SEQ))?.value ?? '0',
        );
        const nextMutationId = (previous + 1n).toString();
        // Use a JSON round trip so callback mutation cannot alter the exact
        // immutable payload already selected for the queue/wire envelope.
        await applyOptimistic?.(
          JSON.parse(jsonPayload) as Readonly<JsonRecord>,
        );
        await this.db.meta.put({
          key: META_MUTATION_SEQ,
          value: nextMutationId,
        });
        const rowId = await this.db.localMutations.add({
          tableName,
          recordId,
          jsonPayload,
          createdAt: Date.now(),
          syncStatus: SYNC_STATUS.PENDING,
          clientId,
          mutationId: nextMutationId,
          operation: 'upsert',
          baseRevision: protocol.baseRevision,
          resurrect: protocol.resurrect,
          attempts: 0,
        });
        return { id: rowId, mutationId: nextMutationId };
      },
    );
    void mutationId;
    return id;
  }

  /** Queue an explicit protocol tombstone instead of overloading a null payload. */
  async queueDelete(
    tableName: string,
    recordId: string,
    options: Pick<ProtocolMutationOptions, 'baseRevision'> = {},
  ): Promise<number> {
    const row = await this.insertDelete(tableName, recordId, options);
    this.triggerBackgroundSync();
    return row;
  }

  /**
   * Apply an optimistic local deletion and queue its tombstone atomically.
   */
  async queueDeleteAtomic(
    tableName: string,
    recordId: string,
    authoritativeTables: readonly Table[],
    applyOptimisticDelete: () => void | Promise<void>,
    options: Pick<ProtocolMutationOptions, 'baseRevision'> = {},
  ): Promise<number> {
    const row = await this.insertDelete(
      tableName,
      recordId,
      options,
      authoritativeTables,
      applyOptimisticDelete,
    );
    this.triggerBackgroundSync();
    return row;
  }

  /**
   * Validate payload quotas, then enqueue one whole import as a single
   * IndexedDB transaction with contiguous protocol identities.
   *
   * This is the durable boundary used by the shared JSON ingest API. Either
   * every mutation is visible to the foreground/service-worker loop or none
   * are; a malformed/quota-exceeding record cannot leave a partial batch.
   */
  async queueBatch(
    mutations: readonly QueueBatchMutation[],
  ): Promise<readonly number[]> {
    if (mutations.length === 0) {
      throw new TypeError('queueBatch requires at least one mutation');
    }
    const prepared: Array<
      QueueBatchMutation & { jsonPayload: string; clientId: string }
    > = [];
    for (const mutation of mutations) {
      if (mutation.operation === 'delete') {
        this.assertPayloadQuota('{}');
        prepared.push({
          ...mutation,
          jsonPayload: '{}',
          clientId: await this.clientId(),
        });
      } else {
        const upsert = await this.prepareUpsert(mutation.payload);
        prepared.push({
          ...mutation,
          jsonPayload: upsert.jsonPayload,
          clientId: upsert.clientId,
        });
      }
    }

    const rows = await this.db.transaction(
      'rw',
      [this.db.localMutations, this.db.meta],
      async () => {
        await this.assertPendingBatchQuota(prepared.length);
        let sequence = BigInt(
          (await this.db.meta.get(META_MUTATION_SEQ))?.value ?? '0',
        );
        const ids: number[] = [];
        for (const mutation of prepared) {
          sequence += 1n;
          const id = await this.db.localMutations.add({
            tableName: mutation.tableName,
            recordId: mutation.recordId,
            jsonPayload: mutation.jsonPayload,
            createdAt: Date.now(),
            syncStatus: SYNC_STATUS.PENDING,
            clientId: mutation.clientId,
            mutationId: sequence.toString(),
            operation: mutation.operation,
            baseRevision: mutation.baseRevision,
            resurrect:
              mutation.operation === 'upsert'
                ? mutation.resurrect
                : undefined,
            attempts: 0,
          });
          ids.push(id);
        }
        await this.db.meta.put({
          key: META_MUTATION_SEQ,
          value: sequence.toString(),
        });
        return ids;
      },
    );
    this.triggerBackgroundSync();
    return rows;
  }

  private async insertDelete(
    tableName: string,
    recordId: string,
    options: Pick<ProtocolMutationOptions, 'baseRevision'>,
    authoritativeTables: readonly Table[] = [],
    applyOptimisticDelete?: () => void | Promise<void>,
  ): Promise<number> {
    this.assertPayloadQuota('{}');
    const clientId = await this.clientId();
    const row = await this.db.transaction(
      'rw',
      [this.db.localMutations, this.db.meta, ...authoritativeTables],
      async () => {
        await this.assertPendingQuota();
        const previous = BigInt(
          (await this.db.meta.get(META_MUTATION_SEQ))?.value ?? '0',
        );
        const mutationId = (previous + 1n).toString();
        await applyOptimisticDelete?.();
        await this.db.meta.put({ key: META_MUTATION_SEQ, value: mutationId });
        return this.db.localMutations.add({
          tableName,
          recordId,
          // Retained as valid JSON for old queue inspectors. The wire encoder
          // omits payload for delete operations.
          jsonPayload: '{}',
          createdAt: Date.now(),
          syncStatus: SYNC_STATUS.PENDING,
          clientId,
          mutationId,
          operation: 'delete',
          baseRevision: options.baseRevision,
          attempts: 0,
        });
      },
    );
    return row;
  }

  /**
   * Delete old acknowledged rows while retaining the newest entries for local
   * diagnostics. Pending work is never removed.
   */
  async pruneConfirmed(retain = 1000): Promise<number> {
    if (!Number.isSafeInteger(retain) || retain < 0) {
      throw new RangeError('retain must be a non-negative safe integer');
    }
    return this.db.transaction('rw', this.db.localMutations, async () => {
      const confirmed = await this.db.localMutations
        .where('syncStatus')
        .equals(SYNC_STATUS.SYNCED)
        .sortBy('id');
      const removable = confirmed.slice(0, Math.max(0, confirmed.length - retain));
      if (removable.length === 0) return 0;
      await this.db.localMutations.bulkDelete(
        removable.map((mutation) => mutation.id!).filter(Number.isSafeInteger),
      );
      return removable.length;
    });
  }

  /**
   * Stable per-install protocol identity, persisted alongside the clock.
   *
   * This is the durable device id, not the HLC node id. The latter deliberately
   * has a fresh per-tab suffix to prevent equal timestamps; using it for the
   * mutation ledger would strand queued rows whenever a tab or process restarts.
   * Tabs sharing this IndexedDB also share one atomic mutation sequence.
   */
  async clientId(): Promise<string> {
    await this.clock();
    const id = (await this.db.meta.get(META_NODE_ID))?.value;
    if (!id) throw new Error('durable client id was not initialized');
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
    // Insertion order, explicitly. Callers replay these to build the local view
    // and push them in this order; an index-ordered result is not guaranteed to
    // be insertion-ordered, and replaying two edits to one record backwards
    // shows the older value.
    return mutations.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
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

  /**
   * The view to render for one record: authoritative server state with this
   * client's un-confirmed writes replayed on top.
   *
   * Call this instead of rendering `reconcileIncoming` directly whenever a
   * queue is in play. `reconcileIncoming` reconciles two documents; it knows
   * nothing about the mutations still waiting to be pushed, so rendering its
   * result drops any pending edit the server's timestamp outranks — the edit
   * reappears later when the push lands, which reads as the UI undoing and then
   * redoing the user's work.
   *
   * Pending payloads are replayed oldest-first, matching the order they will
   * reach the server. See `rebasePending` for why the overlay is not
   * timestamp-gated by default.
   */
  async localView(
    tableName: string,
    recordId: string,
    serverPayload: JsonRecord,
    overrides?: RebaseOptions,
  ): Promise<JsonRecord> {
    const pending = (await this.pendingMutations(tableName)).filter(
      (m) => m.recordId === recordId,
    );
    const payloads = pending.map(
      (m) => JSON.parse(m.jsonPayload) as JsonRecord,
    );
    return rebasePending(serverPayload, payloads, {
      ...this.options,
      ...overrides,
    });
  }

  /**
   * Discard local mutations the server has confirmed.
   *
   * The server reports the highest `mutationId` it has durably applied for this
   * client; everything at or below it is no longer pending. This is the other
   * half of at-least-once push: without it a mutation that was applied but
   * whose response was lost stays queued forever and is replayed on every
   * rebase, so the record never settles on server truth.
   *
   * @returns How many rows were confirmed.
   */
  async confirmSyncedUpTo(
    lastMutationId: string | number,
    clientId?: string,
  ): Promise<number> {
    const id = clientId ?? (await this.clientId());
    const watermark = BigInt(lastMutationId);
    const confirmed = await this.db.localMutations
      .where('syncStatus')
      .equals(SYNC_STATUS.PENDING)
      .filter(
        (m) =>
          m.clientId === id &&
          m.mutationId !== undefined &&
          BigInt(m.mutationId) <= watermark,
      )
      .toArray();

    await this.db.localMutations.bulkUpdate(
      confirmed.map((m) => ({
        key: m.id as number,
        changes: { syncStatus: SYNC_STATUS.SYNCED },
      })),
    );
    return confirmed.length;
  }

  /** Encode one immutable, insertion-ordered protocol v1 push batch. */
  async protocolPushRequest(
    optionsOrLimit: ProtocolMutationOptions | number = {},
    limit = 100,
  ): Promise<PushRequest> {
    if (
      typeof optionsOrLimit !== 'number' &&
      (optionsOrLimit.baseRevision !== undefined ||
        optionsOrLimit.resurrect !== undefined)
    ) {
      throw new Error(
        'protocol options must be persisted by queueMutation; protocolPushRequest only accepts a batch limit',
      );
    }
    const options =
      typeof optionsOrLimit === 'number' ? {} : optionsOrLimit;
    const resolvedLimit =
      typeof optionsOrLimit === 'number' ? optionsOrLimit : limit;
    return buildPushRequest(
      await this.clientId(),
      await this.pendingMutations(),
      options,
      resolvedLimit,
    );
  }

  /**
   * Apply a protocol push acknowledgement.
   *
   * Rejected mutations are included in the server watermark, so they leave the
   * pending queue too; their detailed outcomes remain available in `results`
   * for application-level conflict UI or logging.
   */
  async acknowledgePush(
    response: PushResponse,
    request: PushRequest,
  ): Promise<number> {
    validatePushResponse(request, response);
    const clientId = await this.clientId();
    if (request.clientId !== clientId) {
      throw new Error('push acknowledgement does not match the sent batch');
    }
    return this.db.transaction('rw', this.db.localMutations, async () => {
      const pending = (
        await this.db.localMutations
          .where('syncStatus')
          .equals(SYNC_STATUS.PENDING)
          .toArray()
      ).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      const expected = buildPushRequest(
        clientId,
        pending,
        {},
        request.mutations.length,
      );
      if (JSON.stringify(expected) !== JSON.stringify(request)) {
        throw new Error('push acknowledgement does not match the sent batch');
      }
      const confirmed = pending.slice(0, request.mutations.length);
      await this.db.localMutations.bulkUpdate(
        confirmed.map((mutation) => ({
          key: mutation.id as number,
          changes: { syncStatus: SYNC_STATUS.SYNCED },
        })),
      );
      return confirmed.length;
    });
  }

  /** Last pull checkpoint persisted by the application, or `"0"` initially. */
  async pullCheckpoint(): Promise<string> {
    return (await this.db.meta.get(META_PULL_CHECKPOINT))?.value ?? '0';
  }

  /**
   * Persist an opaque protocol checkpoint.
   *
   * When the authoritative store shares this database, persist this in the
   * same transaction as its changes. Otherwise apply changes idempotently
   * first, then advance the checkpoint; a crash between those operations
   * safely replays the same pull page.
   */
  async setPullCheckpoint(checkpoint: string): Promise<void> {
    this.assertCheckpoint(checkpoint);
    await this.db.meta.put({ key: META_PULL_CHECKPOINT, value: checkpoint });
  }

  /**
   * Commit one authoritative pull page and its checkpoint in one IndexedDB
   * transaction. Every table touched by `applyChanges` must be listed.
   */
  async commitPullPageAtomic(
    checkpoint: string,
    authoritativeTables: readonly Table[],
    applyChanges: () => void | Promise<void>,
  ): Promise<void> {
    this.assertCheckpoint(checkpoint);
    await this.db.transaction(
      'rw',
      [this.db.meta, ...authoritativeTables],
      async () => {
        await applyChanges();
        await this.db.meta.put({
          key: META_PULL_CHECKPOINT,
          value: checkpoint,
        });
      },
    );
  }

  /**
   * Install one reset snapshot without losing optimistic work.
   *
   * `replaceAuthoritative` must replace the caller's synced store atomically;
   * this queue cannot transact an unrelated database. The checkpoint advances
   * only after that callback succeeds. A crash before then safely retries the
   * whole replacement, while pending mutations remain queued for rebase.
   */
  async installSnapshot(
    snapshot: SnapshotResponse,
    replaceAuthoritative: (records: readonly SnapshotRecord[]) => Promise<void>,
  ): Promise<void> {
    this.assertSnapshot(snapshot);
    await replaceAuthoritative(snapshot.records);
    await this.setPullCheckpoint(snapshot.checkpoint);
  }

  /**
   * Atomically replace same-database authoritative rows and advance the reset
   * checkpoint. Pending optimistic mutations are outside the transaction's
   * write set and remain queued for rebase.
   */
  async installSnapshotAtomic(
    snapshot: SnapshotResponse,
    authoritativeTables: readonly Table[],
    replaceAuthoritative: (
      records: readonly SnapshotRecord[],
    ) => void | Promise<void>,
  ): Promise<void> {
    this.assertSnapshot(snapshot);
    await this.db.transaction(
      'rw',
      [this.db.meta, ...authoritativeTables],
      async () => {
        await replaceAuthoritative(snapshot.records);
        await this.db.meta.put({
          key: META_PULL_CHECKPOINT,
          value: snapshot.checkpoint,
        });
      },
    );
  }

  private assertCheckpoint(checkpoint: string): void {
    if (!/^(?:0|[1-9]\d*)$/.test(checkpoint)) {
      throw new Error('checkpoint must be a canonical unsigned decimal string');
    }
  }

  private assertSnapshot(snapshot: SnapshotResponse): void {
    if (
      snapshot.protocolVersion !== 1 ||
      !/^(?:0|[1-9]\d*)$/.test(snapshot.checkpoint) ||
      !Array.isArray(snapshot.records) ||
      !snapshot.records.every(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof entry.table === 'string' &&
          entry.table.length > 0 &&
          typeof entry.recordId === 'string' &&
          entry.recordId.length > 0 &&
          typeof entry.revision === 'string' &&
          /^[1-9]\d*$/.test(entry.revision) &&
          entry.record !== null &&
          typeof entry.record === 'object' &&
          !Array.isArray(entry.record),
      )
    ) {
      throw new Error('snapshot is not a valid protocol v1 snapshot');
    }
  }

  /**
   * Record a failed push attempt. Kept separate from `markMutation` so a
   * transient failure increments the attempt count for backoff instead of
   * burning the row to FAILED on the first network blip.
   */
  async recordPushFailure(id: number, error: string): Promise<void> {
    const row = await this.db.localMutations.get(id);
    if (!row) return;
    await this.db.localMutations.update(id, {
      attempts: (row.attempts ?? 0) + 1,
      // Truncated and never the payload: this can reach logs.
      lastError: error.slice(0, 200),
    });
  }

  /**
   * Attach or replace the wake-up hook used after a durable queue commit.
   *
   * `ProtocolSyncLoop.hint()` is the standard target. The callback is a hint
   * only: queue durability never depends on it, and callback failures cannot
   * roll back an already-committed optimistic write.
   */
  setBackgroundSyncTrigger(trigger?: () => void): void {
    this.backgroundSyncTrigger = trigger;
  }

  private triggerBackgroundSync() {
    try {
      this.backgroundSyncTrigger?.();
    } catch {
      // A lifecycle/observability hook must never make durable queueing fail.
    }
  }
}
