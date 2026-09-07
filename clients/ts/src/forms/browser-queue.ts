import {
  DEFAULT_FORM_DATABASE,
  DEFAULT_FORM_STORE,
  DEFAULT_MAX_FORM_PAYLOAD_BYTES,
  DEFAULT_MAX_PENDING_FORMS,
  FORM_SYNC_STATUS,
  type BrowserFormMutation,
  type BrowserFormQueueOptions,
  type FormJsonRecord,
  type FormMutationQueue,
  type FormProtocolMutationOptions,
} from './types.js';

function required(value: string | undefined, label: string): string {
  const result = value?.trim();
  if (!result) throw new Error(`${label} must not be blank`);
  return result;
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed')),
      { once: true },
    );
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      { once: true },
    );
  });
}
function abort(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // It already completed or aborted.
  }
}

/** Dependency-free Opto Sync queue for static pages and progressive enhancement. */
export class BrowserFormQueue implements FormMutationQueue {
  private readonly databaseName: string;
  private readonly maxPending: number;
  private readonly maxBytes: number;
  private database?: Promise<IDBDatabase>;

  constructor(options: BrowserFormQueueOptions = {}) {
    this.databaseName = required(
      options.databaseName ?? DEFAULT_FORM_DATABASE,
      'databaseName',
    );
    this.maxPending = options.maxPendingMutations ?? DEFAULT_MAX_PENDING_FORMS;
    this.maxBytes = options.maxQueuedPayloadBytes ?? DEFAULT_MAX_FORM_PAYLOAD_BYTES;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) {
      throw new RangeError('maxPendingMutations must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 2) {
      throw new RangeError('maxQueuedPayloadBytes must be at least 2');
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('opto-sync forms require IndexedDB'));
    }
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.addEventListener('upgradeneeded', () => {
        const store = request.result.createObjectStore(DEFAULT_FORM_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('syncStatus', 'syncStatus');
        store.createIndex('tableName', 'tableName');
        store.createIndex('recordId', 'recordId');
      });
      request.addEventListener(
        'success',
        () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(DEFAULT_FORM_STORE)) {
            database.close();
            this.database = undefined;
            reject(new Error('IndexedDB form queue schema is missing'));
            return;
          }
          database.addEventListener('versionchange', () => {
            database.close();
            this.database = undefined;
          });
          resolve(database);
        },
        { once: true },
      );
      request.addEventListener(
        'error',
        () => {
          this.database = undefined;
          reject(request.error ?? new Error('unable to open IndexedDB form queue'));
        },
        { once: true },
      );
      request.addEventListener(
        'blocked',
        () => {
          this.database = undefined;
          reject(new Error('IndexedDB form queue upgrade is blocked'));
        },
        { once: true },
      );
    });
    return this.database;
  }

  async queueMutation(
    tableName: string,
    recordId: string,
    payload: FormJsonRecord,
    protocol: FormProtocolMutationOptions = {},
  ): Promise<number> {
    const jsonPayload = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(jsonPayload).byteLength;
    if (bytes > this.maxBytes) {
      throw new RangeError(`queued form payload is ${bytes} bytes; limit is ${this.maxBytes}`);
    }
    const database = await this.open();
    const transaction = database.transaction(DEFAULT_FORM_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(DEFAULT_FORM_STORE);
    try {
      const count = await requestResult(
        store.index('syncStatus').count(IDBKeyRange.only(FORM_SYNC_STATUS.PENDING)),
      );
      if (count >= this.maxPending) {
        throw new RangeError(`pending form queue has reached ${this.maxPending}`);
      }
      const row: BrowserFormMutation = {
        tableName: required(tableName, 'tableName'),
        recordId: required(recordId, 'recordId'),
        jsonPayload,
        createdAt: Date.now(),
        syncStatus: FORM_SYNC_STATUS.PENDING,
        operation: 'upsert',
        attempts: 0,
        ...(protocol.baseRevision !== undefined
          ? { baseRevision: protocol.baseRevision }
          : {}),
        ...(protocol.resurrect !== undefined
          ? { resurrect: protocol.resurrect }
          : {}),
        ...(protocol.consistencyPolicy !== undefined
          ? { consistencyPolicy: protocol.consistencyPolicy }
          : {}),
      };
      const key = await requestResult(store.add(row));
      await done;
      const id = typeof key === 'number' ? key : Number(key);
      if (!Number.isSafeInteger(id)) throw new Error('invalid IndexedDB mutation id');
      return id;
    } catch (error) {
      abort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  }

  async pendingMutations(tableName?: string): Promise<BrowserFormMutation[]> {
    const database = await this.open();
    const transaction = database.transaction(DEFAULT_FORM_STORE, 'readonly');
    const done = transactionDone(transaction);
    const rows = (await requestResult(
      transaction
        .objectStore(DEFAULT_FORM_STORE)
        .index('syncStatus')
        .getAll(IDBKeyRange.only(FORM_SYNC_STATUS.PENDING)),
    )) as BrowserFormMutation[];
    await done;
    return rows
      .filter((row) => tableName === undefined || row.tableName === tableName)
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  async markMutation(id: number, syncStatus: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) throw new RangeError('invalid mutation id');
    if (!(Object.values(FORM_SYNC_STATUS) as number[]).includes(syncStatus)) {
      throw new RangeError('invalid form sync status');
    }
    const database = await this.open();
    const transaction = database.transaction(DEFAULT_FORM_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(DEFAULT_FORM_STORE);
    try {
      const row = (await requestResult(store.get(id))) as BrowserFormMutation | undefined;
      if (!row) throw new Error(`form mutation ${id} was not found`);
      row.syncStatus = syncStatus;
      await requestResult(store.put(row));
      await done;
    } catch (error) {
      abort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  }

  /** Delete sensitive form payloads after the server returns a canonical receipt. */
  async deleteMutation(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) throw new RangeError('invalid mutation id');
    const database = await this.open();
    const transaction = database.transaction(DEFAULT_FORM_STORE, 'readwrite');
    const done = transactionDone(transaction);
    try {
      await requestResult(transaction.objectStore(DEFAULT_FORM_STORE).delete(id));
      await done;
    } catch (error) {
      abort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.database) return;
    (await this.database).close();
    this.database = undefined;
  }
}

export function createBrowserFormQueue(
  options?: BrowserFormQueueOptions,
): BrowserFormQueue {
  return new BrowserFormQueue(options);
}
