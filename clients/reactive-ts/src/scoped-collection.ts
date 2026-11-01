/**
 * Fixed-membership, record-ID-scoped read projections (pilot).
 *
 * This is an opt-in read model, not a new mutation ledger, merge engine,
 * authorization layer, or replacement for protocol-v1 push/pull. The server
 * MUST authorize every member and bind its checkpoint to this exact scope.
 */
export interface RecordIdScopeV1 {
  readonly version: 1;
  readonly table: string;
  readonly recordIds: readonly string[];
}

export interface ScopedRecord<T> {
  readonly recordId: string;
  readonly revision: string;
  readonly record: T;
}

export interface ScopedSnapshotV1<T> {
  readonly protocolVersion: 1;
  readonly scopeKey: string;
  readonly checkpoint: string;
  readonly records: readonly ScopedRecord<T>[];
}

export interface ScopedChange<T> {
  readonly checkpoint: string;
  readonly recordId: string;
  readonly revision: string;
  readonly operation: 'upsert' | 'delete';
  readonly record?: T;
}

export interface ScopedPullPageV1<T> {
  readonly protocolVersion: 1;
  readonly scopeKey: string;
  readonly fromCheckpoint: string;
  readonly checkpoint: string;
  readonly hasMore: boolean;
  readonly changes: readonly ScopedChange<T>[];
}

export interface ScopedCollectionView<T> {
  readonly scopeKey: string;
  readonly checkpoint: string | null;
  readonly ready: boolean;
  /** Pending local writes are projected by the host; they are never replaced by a pull. */
  readonly rows: ReadonlyMap<string, T>;
}

export interface ScopedCollectionOptions<T> {
  readonly sessionPartition: string;
  readonly scope: RecordIdScopeV1;
  /**
   * Host must atomically install authoritative rows AND checkpoint in its own
   * IndexedDB/SQLite transaction. Throwing keeps the in-memory head unchanged.
   * This callback must enforce session/scope generation fencing.
   */
  readonly persist?: (rows: ReadonlyMap<string, ScopedRecord<T>>, checkpoint: string) => Promise<void>;
  /** Delegate to existing client.localView / durable pending mutation ledger. */
  readonly projectLocalView?: (recordId: string, authoritative: T | null) => T | null;
}

const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_I64 = 9223372036854775807n;
const TABLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function decimal(value: string): bigint {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new RangeError('noncanonical decimal checkpoint or revision');
  }
  const n = BigInt(value);
  if (n > MAX_I64) throw new RangeError('checkpoint or revision exceeds signed 64-bit range');
  return n;
}

export function canonicalRecordIdScope(scope: RecordIdScopeV1): RecordIdScopeV1 {
  if (scope.version !== 1 || !TABLE.test(scope.table)) {
    throw new RangeError('unsupported scope version or table');
  }
  if (!Array.isArray(scope.recordIds) || scope.recordIds.length < 1 || scope.recordIds.length > 128) {
    throw new RangeError('scope requires 1 to 128 explicit record ids');
  }
  const ids = scope.recordIds.slice();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length < 1 || id.length > 512) {
      throw new RangeError('invalid record id in scope');
    }
  }
  ids.sort();
  if (ids.some((id, i) => i > 0 && id === ids[i - 1])) {
    throw new RangeError('duplicate record id in scope');
  }
  return Object.freeze({ version: 1, table: scope.table, recordIds: Object.freeze(ids) });
}

/** This key must never be logged: it includes tenant/user partition and record ids. */
export function scopedCollectionKey(scope: RecordIdScopeV1, sessionPartition: string): string {
  const canonical = canonicalRecordIdScope(scope);
  if (typeof sessionPartition !== 'string' || sessionPartition.length === 0) {
    throw new RangeError('scope requires nonempty session partition');
  }
  return JSON.stringify([canonical.version, sessionPartition, canonical.table, canonical.recordIds]);
}

export class ScopedCollection<T> {
  readonly scope: RecordIdScopeV1;
  readonly scopeKey: string;

  private readonly allowed: ReadonlySet<string>;
  private readonly listeners = new Set<(view: ScopedCollectionView<T>) => void>();
  private readonly options: ScopedCollectionOptions<T>;
  private records = new Map<string, ScopedRecord<T>>();
  private checkpoint: string | null = null;
  private ready = false;
  private closed = false;
  private serial: Promise<void> = Promise.resolve();

  constructor(options: ScopedCollectionOptions<T>) {
    this.options = options;
    this.scope = canonicalRecordIdScope(options.scope);
    this.scopeKey = scopedCollectionKey(this.scope, options.sessionPartition);
    this.allowed = new Set(this.scope.recordIds);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('scoped collection is closed');
  }

  private validateRecord(record: ScopedRecord<T>): void {
    if (!this.allowed.has(record.recordId)) throw new RangeError('record outside scope');
    decimal(record.revision);
    if (record.record === undefined) throw new RangeError('upsert record is missing');
  }

  private queue(operation: () => Promise<void>): Promise<void> {
    this.assertOpen();
    const next = this.serial.then(operation);
    // A rejected transaction must not permanently poison subsequent retries.
    this.serial = next.catch(() => undefined);
    return next;
  }

  private async commit(nextRows: Map<string, ScopedRecord<T>>, nextCheckpoint: string): Promise<void> {
    this.assertOpen();
    await this.options.persist?.(new Map(nextRows), nextCheckpoint);
    this.assertOpen();
    this.records = nextRows;
    this.checkpoint = nextCheckpoint;
    this.ready = true;
    this.publish();
  }

  getView(): ScopedCollectionView<T> {
    const rows = new Map<string, T>();
    for (const id of this.scope.recordIds) {
      const authoritative = this.records.get(id)?.record ?? null;
      const local = this.options.projectLocalView
        ? this.options.projectLocalView(id, authoritative)
        : authoritative;
      if (local !== null) rows.set(id, local);
    }
    return {
      scopeKey: this.scopeKey,
      checkpoint: this.checkpoint,
      ready: this.ready,
      rows,
    };
  }

  subscribe(listener: (view: ScopedCollectionView<T>) => void): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    if (this.ready) listener(this.getView());
    return () => { this.listeners.delete(listener); };
  }

  /** Notify after the existing client durably writes or settles its mutation queue. */
  notifyLocalChange(): void {
    this.assertOpen();
    if (this.ready) this.publish();
  }

  private publish(): void {
    const view = this.getView();
    for (const listener of this.listeners) {
      try { listener(view); } catch { /* UI observers may not change sync correctness */ }
    }
  }

  installSnapshot(snapshot: ScopedSnapshotV1<T>): Promise<void> {
    return this.queue(async () => {
      if (snapshot.protocolVersion !== 1 || snapshot.scopeKey !== this.scopeKey) {
        throw new RangeError('scope or protocol mismatch in snapshot');
      }
      const incoming = decimal(snapshot.checkpoint);
      if (this.ready && this.checkpoint !== null && incoming < decimal(this.checkpoint)) {
        throw new RangeError('stale scoped snapshot');
      }
      if (!Array.isArray(snapshot.records) || snapshot.records.length > this.scope.recordIds.length) {
        throw new RangeError('oversized or invalid scoped snapshot');
      }
      const next = new Map<string, ScopedRecord<T>>();
      for (const row of snapshot.records) {
        this.validateRecord(row);
        if (next.has(row.recordId)) throw new RangeError('duplicate snapshot record');
        next.set(row.recordId, row);
      }
      await this.commit(next, snapshot.checkpoint);
    });
  }

  applyPullPage(page: ScopedPullPageV1<T>): Promise<void> {
    return this.queue(async () => {
      if (!this.ready || this.checkpoint === null) {
        throw new Error('scoped snapshot required before applying deltas');
      }
      if (page.protocolVersion !== 1 || page.scopeKey !== this.scopeKey ||
          page.fromCheckpoint !== this.checkpoint) {
        throw new RangeError('scope or starting checkpoint mismatch');
      }
      const from = decimal(page.fromCheckpoint);
      const to = decimal(page.checkpoint);
      if (to < from) throw new RangeError('scoped checkpoint regressed');
      if (!Array.isArray(page.changes) || page.changes.length > 1000 ||
          (page.hasMore && page.changes.length === 0 && to === from)) {
        throw new RangeError('invalid scoped pull page');
      }
      const next = new Map(this.records);
      let previous = from;
      for (const change of page.changes) {
        if (!this.allowed.has(change.recordId)) throw new RangeError('change outside scope');
        const at = decimal(change.checkpoint);
        if (at <= previous || at > to) throw new RangeError('out-of-order scoped change');
        decimal(change.revision);
        if (change.operation === 'delete') {
          if (change.record !== undefined) throw new RangeError('delete cannot carry record');
          next.delete(change.recordId);
        } else if (change.operation === 'upsert') {
          if (change.record === undefined) throw new RangeError('upsert requires record');
          next.set(change.recordId, {
            recordId: change.recordId,
            revision: change.revision,
            record: change.record,
          });
        } else {
          throw new RangeError('unknown change operation');
        }
        previous = at;
      }
      // The caller may advance across invisible commits, but the server must
      // generate its scope-filtered page from a consistent source snapshot.
      await this.commit(next, page.checkpoint);
    });
  }

  /** RESET_REQUIRED invalidates the scoped head, never the application's queue. */
  requireSnapshot(): Promise<void> {
    return this.queue(async () => {
      this.ready = false;
      this.checkpoint = null;
      this.records = new Map();
      this.publish();
    });
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

export function createScopedCollection<T>(options: ScopedCollectionOptions<T>): ScopedCollection<T> {
  return new ScopedCollection(options);
}
