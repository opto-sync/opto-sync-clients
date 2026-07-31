import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type {
  DesktopLeaseGrant,
  DesktopLeaseRequest,
  DesktopLeaseStore,
  DesktopWakeReason,
} from './desktop.ts';

export const SQLITE_DESKTOP_COORDINATION_SCHEMA_VERSION = 1 as const;
const TABLE = 'opto_sync_desktop_coordination_v1';
const MAX_GENERATION = 9_223_372_036_854_775_807n;
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 15 * 60_000;

export interface SqliteDesktopCoordinatorOptions {
  busyTimeoutMs?: number;
  initializePragmas?: boolean;
}

export interface SqliteDesktopAcquireRequest {
  key: string;
  ownerId: string;
  token: string;
  leaseTtlMs: number;
}

export interface SqliteDesktopLeaseGrant extends DesktopLeaseGrant {
  acquiredAtMs: number;
  wakeGeneration: string;
  handledGeneration: string;
}

export interface SqliteDesktopWakeReceipt {
  generation: string;
  handledGeneration: string;
  dirty: boolean;
  retryAfterMs: number;
}

export interface SqliteDesktopBusyResult {
  status: 'busy';
  retryAfterMs: number;
  wakeGeneration: string;
  handledGeneration: string;
}

export interface SqliteDesktopAcquiredResult {
  status: 'acquired';
  grant: SqliteDesktopLeaseGrant;
}

export type SqliteDesktopAcquireResult =
  | SqliteDesktopBusyResult
  | SqliteDesktopAcquiredResult;

export interface SqliteDesktopCompletion {
  released: boolean;
  currentWakeGeneration: string;
  handledGeneration: string;
}

export interface SqliteDesktopState {
  key: string;
  fence: string;
  expiresAtMs: number;
  wakeGeneration: string;
  handledGeneration: string;
  dirty: boolean;
  owned: boolean;
  retryAfterMs: number;
}

interface CoordinationRow {
  owner_token: string | null;
  fence: string;
  expires_at_ms: number;
  wake_generation: string;
  handled_generation: string;
}

export class StaleDesktopFenceError extends Error {
  constructor(message = 'desktop SQLite fence is stale, expired, or no longer owned') {
    super(message);
    this.name = 'StaleDesktopFenceError';
  }
}

function validateIdentifier(name: string, value: string): void {
  if (!value || value.length > 512) {
    throw new RangeError(`${name} must be 1 through 512 characters`);
  }
}

function validateTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
    throw new RangeError(
      `leaseTtlMs must be an integer from ${MIN_TTL_MS} through ${MAX_TTL_MS}`,
    );
  }
}

function parseGeneration(name: string, value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RangeError(`${name} must be a non-negative decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_GENERATION) {
    throw new RangeError(`${name} exceeds SQLite's signed 64-bit range`);
  }
  return parsed;
}

function asInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`SQLite returned an invalid ${name}`);
  }
  return value;
}

function asText(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`SQLite returned an invalid ${name}`);
  }
  return value;
}

function asNullableText(value: unknown, name: string): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`SQLite returned an invalid ${name}`);
  }
  return value;
}

/**
 * Shared, store-authoritative SQLite coordinator for Node/Electron desktop hosts.
 *
 * Only coordination metadata is stored: lease key, opaque ephemeral owner token,
 * monotonic fence, expiry, and wake/handled generations. Credentials, mutation
 * payloads, database URLs, tenant secrets, and stable device identifiers do not
 * belong in this table.
 */
export class NodeSqliteDesktopCoordinator implements DesktopLeaseStore {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(path: string, options: SqliteDesktopCoordinatorOptions = {}) {
    if (!path) throw new RangeError('SQLite path must not be empty');
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(busyTimeoutMs) ||
      busyTimeoutMs < 0 ||
      busyTimeoutMs > 60_000
    ) {
      throw new RangeError('busyTimeoutMs must be an integer from 0 through 60000');
    }

    this.#database = new DatabaseSync(path);
    if (options.initializePragmas !== false) {
      this.#database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      this.#database.exec('PRAGMA foreign_keys = ON');
      this.#database.exec('PRAGMA journal_mode = WAL');
      this.#database.exec('PRAGMA synchronous = FULL');
    }
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        lease_key TEXT PRIMARY KEY NOT NULL,
        owner_token TEXT,
        fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
        expires_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (expires_at_ms >= 0),
        wake_generation INTEGER NOT NULL DEFAULT 0 CHECK (wake_generation >= 0),
        handled_generation INTEGER NOT NULL DEFAULT 0 CHECK (
          handled_generation >= 0 AND handled_generation <= wake_generation
        ),
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (updated_at_ms >= 0)
      ) STRICT
    `);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  signalWake(key: string): SqliteDesktopWakeReceipt {
    this.#ensureOpen();
    validateIdentifier('lease key', key);
    return this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      this.#ensureRow(key, nowMs);
      const before = this.#readRow(key);
      if (parseGeneration('wake generation', before.wake_generation) >= MAX_GENERATION) {
        throw new RangeError('wake generation exhausted SQLite signed 64-bit range');
      }
      this.#database
        .prepare(
          `UPDATE ${TABLE}
             SET wake_generation = wake_generation + 1,
                 updated_at_ms = ?
           WHERE lease_key = ?`,
        )
        .run(nowMs, key);
      const row = this.#readRow(key);
      return {
        generation: row.wake_generation,
        handledGeneration: row.handled_generation,
        dirty: row.wake_generation !== row.handled_generation,
        retryAfterMs:
          row.owner_token === null ? 0 : Math.max(0, row.expires_at_ms - nowMs),
      };
    });
  }

  acquire(request: SqliteDesktopAcquireRequest): SqliteDesktopAcquireResult {
    this.#ensureOpen();
    validateIdentifier('lease key', request.key);
    validateIdentifier('owner id', request.ownerId);
    validateIdentifier('owner token', request.token);
    validateTtl(request.leaseTtlMs);

    return this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      this.#ensureRow(request.key, nowMs);
      const current = this.#readRow(request.key);
      if (current.owner_token !== null && current.expires_at_ms > nowMs) {
        return {
          status: 'busy',
          retryAfterMs: current.expires_at_ms - nowMs,
          wakeGeneration: current.wake_generation,
          handledGeneration: current.handled_generation,
        };
      }
      if (parseGeneration('fence', current.fence) >= MAX_GENERATION) {
        throw new RangeError('lease fence exhausted SQLite signed 64-bit range');
      }

      const expiresAtMs = nowMs + request.leaseTtlMs;
      this.#database
        .prepare(
          `UPDATE ${TABLE}
             SET owner_token = ?,
                 fence = fence + 1,
                 expires_at_ms = ?,
                 updated_at_ms = ?
           WHERE lease_key = ?`,
        )
        .run(request.token, expiresAtMs, nowMs, request.key);
      const granted = this.#readRow(request.key);
      return {
        status: 'acquired',
        grant: {
          key: request.key,
          ownerId: request.ownerId,
          token: request.token,
          nowMs,
          acquiredAtMs: nowMs,
          expiresAtMs: granted.expires_at_ms,
          fence: granted.fence,
          wakeGeneration: granted.wake_generation,
          handledGeneration: granted.handled_generation,
        },
      };
    });
  }

  async tryAcquire(
    request: DesktopLeaseRequest,
  ): Promise<SqliteDesktopLeaseGrant | null> {
    const leaseTtlMs = request.expiresAtMs - request.nowMs;
    const result = this.acquire({
      key: request.key,
      ownerId: request.ownerId,
      token: request.token,
      leaseTtlMs,
    });
    return result.status === 'acquired' ? result.grant : null;
  }

  renew(
    grant: SqliteDesktopLeaseGrant,
    leaseTtlMs: number,
  ): SqliteDesktopLeaseGrant | null {
    this.#ensureOpen();
    validateTtl(leaseTtlMs);
    this.#validateGrant(grant);
    return this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      const expiresAtMs = nowMs + leaseTtlMs;
      const result = this.#database
        .prepare(
          `UPDATE ${TABLE}
             SET expires_at_ms = ?, updated_at_ms = ?
           WHERE lease_key = ?
             AND owner_token = ?
             AND fence = CAST(? AS INTEGER)
             AND expires_at_ms > ?`,
        )
        .run(
          expiresAtMs,
          nowMs,
          grant.key,
          grant.token,
          grant.fence,
          nowMs,
        );
      if (Number(result.changes) !== 1) return null;
      const row = this.#readRow(grant.key);
      return {
        ...grant,
        nowMs,
        acquiredAtMs: grant.acquiredAtMs,
        expiresAtMs: row.expires_at_ms,
        wakeGeneration: row.wake_generation,
        handledGeneration: row.handled_generation,
      };
    });
  }

  complete(
    grant: SqliteDesktopLeaseGrant,
    observedWakeGeneration: string,
  ): SqliteDesktopCompletion {
    this.#ensureOpen();
    this.#validateGrant(grant);
    const observed = parseGeneration(
      'observed wake generation',
      observedWakeGeneration,
    );

    return this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      const row = this.#readOwnedUnexpiredRow(grant, nowMs);
      const wake = parseGeneration('wake generation', row.wake_generation);
      const handled = parseGeneration(
        'handled generation',
        row.handled_generation,
      );
      if (observed > wake) {
        throw new RangeError('observed wake generation is ahead of durable state');
      }
      const nextHandled = observed > handled ? observed : handled;
      const released = observed === wake;
      const result = this.#database
        .prepare(
          `UPDATE ${TABLE}
             SET handled_generation = CAST(? AS INTEGER),
                 owner_token = CASE WHEN ? THEN NULL ELSE owner_token END,
                 expires_at_ms = CASE WHEN ? THEN 0 ELSE expires_at_ms END,
                 updated_at_ms = ?
           WHERE lease_key = ?
             AND owner_token = ?
             AND fence = CAST(? AS INTEGER)
             AND expires_at_ms > ?`,
        )
        .run(
          nextHandled.toString(),
          released ? 1 : 0,
          released ? 1 : 0,
          nowMs,
          grant.key,
          grant.token,
          grant.fence,
          nowMs,
        );
      if (Number(result.changes) !== 1) throw new StaleDesktopFenceError();
      return {
        released,
        currentWakeGeneration: wake.toString(),
        handledGeneration: nextHandled.toString(),
      };
    });
  }

  async release(grant: DesktopLeaseGrant): Promise<void> {
    this.#ensureOpen();
    this.#validateGrant(grant);
    this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      this.#database
        .prepare(
          `UPDATE ${TABLE}
             SET owner_token = NULL, expires_at_ms = 0, updated_at_ms = ?
           WHERE lease_key = ?
             AND owner_token = ?
             AND fence = CAST(? AS INTEGER)`,
        )
        .run(nowMs, grant.key, grant.token, grant.fence);
    });
  }

  withFencedWrite<T>(
    grant: DesktopLeaseGrant,
    write: (database: DatabaseSync) => T,
  ): T {
    this.#ensureOpen();
    this.#validateGrant(grant);
    return this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      this.#readOwnedUnexpiredRow(grant, nowMs);
      const result = write(this.#database);
      this.#readOwnedUnexpiredRow(grant, this.#storeNowMs());
      return result;
    });
  }

  assertCurrentFence(grant: DesktopLeaseGrant): void {
    this.#ensureOpen();
    this.#validateGrant(grant);
    this.#transaction(() => {
      this.#readOwnedUnexpiredRow(grant, this.#storeNowMs());
    });
  }

  readState(key: string): SqliteDesktopState {
    this.#ensureOpen();
    validateIdentifier('lease key', key);
    return this.#transaction(() => {
      const nowMs = this.#storeNowMs();
      this.#ensureRow(key, nowMs);
      const row = this.#readRow(key);
      return {
        key,
        fence: row.fence,
        expiresAtMs: row.expires_at_ms,
        wakeGeneration: row.wake_generation,
        handledGeneration: row.handled_generation,
        dirty: row.wake_generation !== row.handled_generation,
        owned: row.owner_token !== null && row.expires_at_ms > nowMs,
        retryAfterMs:
          row.owner_token === null ? 0 : Math.max(0, row.expires_at_ms - nowMs),
      };
    });
  }

  #validateGrant(grant: DesktopLeaseGrant): void {
    validateIdentifier('lease key', grant.key);
    validateIdentifier('owner token', grant.token);
    parseGeneration('fence', grant.fence);
  }

  #readOwnedUnexpiredRow(
    grant: DesktopLeaseGrant,
    nowMs: number,
  ): CoordinationRow {
    const row = this.#readRow(grant.key);
    if (
      row.owner_token !== grant.token ||
      row.fence !== grant.fence ||
      row.expires_at_ms <= nowMs
    ) {
      throw new StaleDesktopFenceError();
    }
    return row;
  }

  #ensureRow(key: string, nowMs: number): void {
    this.#database
      .prepare(
        `INSERT INTO ${TABLE} (
           lease_key, owner_token, fence, expires_at_ms,
           wake_generation, handled_generation, updated_at_ms
         ) VALUES (?, NULL, 0, 0, 0, 0, ?)
         ON CONFLICT(lease_key) DO NOTHING`,
      )
      .run(key, nowMs);
  }

  #readRow(key: string): CoordinationRow {
    const row = this.#database
      .prepare(
        `SELECT owner_token,
                CAST(fence AS TEXT) AS fence,
                expires_at_ms,
                CAST(wake_generation AS TEXT) AS wake_generation,
                CAST(handled_generation AS TEXT) AS handled_generation
           FROM ${TABLE}
          WHERE lease_key = ?`,
      )
      .get(key) as Record<string, unknown> | undefined;
    if (!row) throw new Error('SQLite coordination row disappeared');
    return {
      owner_token: asNullableText(row.owner_token, 'owner token'),
      fence: asText(row.fence, 'fence'),
      expires_at_ms: asInteger(row.expires_at_ms, 'lease expiry'),
      wake_generation: asText(row.wake_generation, 'wake generation'),
      handled_generation: asText(row.handled_generation, 'handled generation'),
    };
  }

  #storeNowMs(): number {
    const row = this.#database
      .prepare(
        `SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms`,
      )
      .get() as Record<string, unknown> | undefined;
    if (!row) throw new Error('SQLite store clock returned no row');
    return asInteger(row.now_ms, 'store clock');
  }

  #transaction<T>(work: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.#database.exec('ROLLBACK');
      } catch {
        // Preserve the original error; the connection will fail subsequent work
        // rather than turning a transaction failure into a false acknowledgement.
      }
      throw error;
    }
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error('desktop SQLite coordinator is closed');
  }
}

export interface SqliteDesktopCycleContext {
  signal: AbortSignal;
  reasons: readonly DesktopWakeReason[];
  ownerId: string;
  leaseKey: string;
  fence: string;
  wakeGeneration: string;
  deadlineMs: number;
  grant: SqliteDesktopLeaseGrant;
  coordinator: NodeSqliteDesktopCoordinator;
}

export type SqliteDesktopSyncCycle<R> = (
  context: SqliteDesktopCycleContext,
) => Promise<R>;

export interface SqliteDesktopRunnerOptions<R> {
  coordinator: NodeSqliteDesktopCoordinator;
  leaseKey: string;
  ownerId: string;
  syncOnce: SqliteDesktopSyncCycle<R>;
  timeoutMs?: number;
  leaseTtlMs?: number;
  busyRetryCapMs?: number;
  busyWaitBudgetMs?: number;
  tokenFactory?: () => string;
  onOutcome?: (outcome: SqliteDesktopSyncOutcome<R>) => void;
}

export interface SqliteDesktopSyncOutcome<R> {
  status: 'completed' | 'busy' | 'failed';
  reasons: readonly DesktopWakeReason[];
  startedAtMs: number;
  finishedAtMs: number;
  fence?: string;
  wakeGeneration?: string;
  handledGeneration?: string;
  result?: R;
  retryAfterMs?: number;
  failurePhase?: 'acquire' | 'cycle' | 'complete' | 'release';
  error?: unknown;
}

export interface SqliteDesktopDrainResult<R> {
  outcomes: readonly SqliteDesktopSyncOutcome<R>[];
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Persistent Node/Electron runner that couples every wake to the durable SQLite
 * generation before attempting ownership. A busy acquisition therefore cannot
 * acknowledge or lose the wake; it retries within the current lease horizon,
 * while an active owner must recheck the generation before release.
 */
export class SqliteCoordinatedDesktopSyncRunner<R> {
  readonly #coordinator: NodeSqliteDesktopCoordinator;
  readonly #leaseKey: string;
  readonly #ownerId: string;
  readonly #syncOnce: SqliteDesktopSyncCycle<R>;
  readonly #timeoutMs: number;
  readonly #leaseTtlMs: number;
  readonly #busyRetryCapMs: number;
  readonly #busyWaitBudgetMs: number;
  readonly #tokenFactory: () => string;
  readonly #onOutcome?: (outcome: SqliteDesktopSyncOutcome<R>) => void;
  readonly #pendingReasons = new Set<DesktopWakeReason>();
  readonly #closeController = new AbortController();
  #drain?: Promise<SqliteDesktopDrainResult<R>>;
  #activeController?: AbortController;
  #closed = false;

  constructor(options: SqliteDesktopRunnerOptions<R>) {
    validateIdentifier('leaseKey', options.leaseKey);
    validateIdentifier('ownerId', options.ownerId);
    const timeoutMs = options.timeoutMs ?? 25_000;
    const leaseTtlMs = options.leaseTtlMs ?? timeoutMs + 5_000;
    const busyRetryCapMs = options.busyRetryCapMs ?? 1_000;
    const busyWaitBudgetMs = options.busyWaitBudgetMs ?? leaseTtlMs + 1_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
      throw new RangeError('timeoutMs must be an integer from 1000 through 600000');
    }
    validateTtl(leaseTtlMs);
    if (leaseTtlMs < timeoutMs + 1_000) {
      throw new RangeError('leaseTtlMs must cover timeoutMs plus 1000ms');
    }
    if (
      !Number.isSafeInteger(busyRetryCapMs) ||
      busyRetryCapMs < 1 ||
      busyRetryCapMs > leaseTtlMs
    ) {
      throw new RangeError('busyRetryCapMs must be from 1 through leaseTtlMs');
    }
    if (
      !Number.isSafeInteger(busyWaitBudgetMs) ||
      busyWaitBudgetMs < busyRetryCapMs ||
      busyWaitBudgetMs > 2 * MAX_TTL_MS
    ) {
      throw new RangeError(
        'busyWaitBudgetMs must cover busyRetryCapMs and be at most 1800000',
      );
    }

    this.#coordinator = options.coordinator;
    this.#leaseKey = options.leaseKey;
    this.#ownerId = options.ownerId;
    this.#syncOnce = options.syncOnce;
    this.#timeoutMs = timeoutMs;
    this.#leaseTtlMs = leaseTtlMs;
    this.#busyRetryCapMs = busyRetryCapMs;
    this.#busyWaitBudgetMs = busyWaitBudgetMs;
    this.#tokenFactory = options.tokenFactory ?? randomUUID;
    this.#onOutcome = options.onOutcome;
  }

  get closed(): boolean {
    return this.#closed;
  }

  wake(
    reason: DesktopWakeReason = 'manual',
  ): Promise<SqliteDesktopDrainResult<R>> {
    if (this.#closed) {
      return Promise.reject(new Error('desktop SQLite sync runner is closed'));
    }
    try {
      this.#coordinator.signalWake(this.#leaseKey);
    } catch (error) {
      return Promise.resolve({
        outcomes: [
          {
            status: 'failed',
            reasons: [reason],
            startedAtMs: Date.now(),
            finishedAtMs: Date.now(),
            failurePhase: 'acquire',
            error,
          },
        ],
      });
    }
    this.#pendingReasons.add(reason);
    if (this.#drain) return this.#drain;
    const running = this.#drainPending().finally(() => {
      if (this.#drain === running) this.#drain = undefined;
    });
    this.#drain = running;
    return running;
  }

  runNow(): Promise<SqliteDesktopDrainResult<R>> {
    return this.wake('manual');
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#pendingReasons.clear();
    const error = abortError('desktop SQLite sync runner closed');
    this.#closeController.abort(error);
    this.#activeController?.abort(error);
  }

  async #drainPending(): Promise<SqliteDesktopDrainResult<R>> {
    const outcomes: SqliteDesktopSyncOutcome<R>[] = [];
    while (!this.#closed && this.#pendingReasons.size > 0) {
      const reasons = [...this.#pendingReasons].sort();
      this.#pendingReasons.clear();
      const produced = await this.#runUntilReleased(reasons);
      for (const outcome of produced) {
        outcomes.push(outcome);
        this.#onOutcome?.(outcome);
      }
    }
    return { outcomes };
  }

  async #runUntilReleased(
    initialReasons: readonly DesktopWakeReason[],
  ): Promise<SqliteDesktopSyncOutcome<R>[]> {
    const outcomes: SqliteDesktopSyncOutcome<R>[] = [];
    const cycleReasons = new Set<DesktopWakeReason>(initialReasons);
    const currentReasons = (): readonly DesktopWakeReason[] =>
      [...cycleReasons].sort();
    const absorbPendingReasons = (): void => {
      for (const reason of this.#pendingReasons) cycleReasons.add(reason);
      this.#pendingReasons.clear();
    };
    const busyStartedAtMs = Date.now();
    let acquisition: SqliteDesktopAcquireResult;
    for (;;) {
      const token = this.#tokenFactory();
      validateIdentifier('tokenFactory result', token);
      try {
        acquisition = this.#coordinator.acquire({
          key: this.#leaseKey,
          ownerId: this.#ownerId,
          token,
          leaseTtlMs: this.#leaseTtlMs,
        });
      } catch (error) {
        return [
          {
            status: 'failed',
            reasons: currentReasons(),
            startedAtMs: busyStartedAtMs,
            finishedAtMs: Date.now(),
            failurePhase: 'acquire',
            error,
          },
        ];
      }
      if (acquisition.status === 'acquired') break;

      const elapsedMs = Date.now() - busyStartedAtMs;
      if (elapsedMs >= this.#busyWaitBudgetMs) {
        return [
          {
            status: 'busy',
            reasons: currentReasons(),
            startedAtMs: busyStartedAtMs,
            finishedAtMs: Date.now(),
            wakeGeneration: acquisition.wakeGeneration,
            handledGeneration: acquisition.handledGeneration,
            retryAfterMs: acquisition.retryAfterMs,
          },
        ];
      }
      const delayMs = Math.max(
        1,
        Math.min(
          this.#busyRetryCapMs,
          acquisition.retryAfterMs || this.#busyRetryCapMs,
          this.#busyWaitBudgetMs - elapsedMs,
        ),
      );
      try {
        await sleep(delayMs, this.#closeController.signal);
      } catch (error) {
        return [
          {
            status: 'failed',
            reasons: currentReasons(),
            startedAtMs: busyStartedAtMs,
            finishedAtMs: Date.now(),
            failurePhase: 'acquire',
            error,
          },
        ];
      }
    }

    absorbPendingReasons();
    let grant = acquisition.grant;
    for (;;) {
      const startedAtMs = Date.now();
      const controller = new AbortController();
      this.#activeController = controller;
      const closeAbort = () => controller.abort(this.#closeController.signal.reason);
      this.#closeController.signal.addEventListener('abort', closeAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: R | undefined;
      let cycleError: unknown;
      try {
        timer = setTimeout(
          () => controller.abort(abortError('opto-sync SQLite desktop cycle timed out')),
          this.#timeoutMs,
        );
        result = await this.#syncOnce({
          signal: controller.signal,
          reasons: currentReasons(),
          ownerId: this.#ownerId,
          leaseKey: this.#leaseKey,
          fence: grant.fence,
          wakeGeneration: grant.wakeGeneration,
          deadlineMs: startedAtMs + this.#timeoutMs,
          grant,
          coordinator: this.#coordinator,
        });
        if (controller.signal.aborted) {
          throw controller.signal.reason ?? abortError('desktop cycle aborted');
        }
      } catch (error) {
        cycleError = error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        this.#closeController.signal.removeEventListener('abort', closeAbort);
        if (this.#activeController === controller) this.#activeController = undefined;
      }

      if (cycleError !== undefined) {
        let releaseError: unknown;
        try {
          await this.#coordinator.release(grant);
        } catch (error) {
          releaseError = error;
        }
        outcomes.push({
          status: 'failed',
          reasons: currentReasons(),
          startedAtMs,
          finishedAtMs: Date.now(),
          fence: grant.fence,
          wakeGeneration: grant.wakeGeneration,
          handledGeneration: grant.handledGeneration,
          failurePhase: releaseError === undefined ? 'cycle' : 'release',
          error: releaseError ?? cycleError,
        });
        return outcomes;
      }

      let completion: SqliteDesktopCompletion;
      try {
        completion = this.#coordinator.complete(grant, grant.wakeGeneration);
      } catch (error) {
        outcomes.push({
          status: 'failed',
          reasons: currentReasons(),
          startedAtMs,
          finishedAtMs: Date.now(),
          fence: grant.fence,
          wakeGeneration: grant.wakeGeneration,
          handledGeneration: grant.handledGeneration,
          result,
          failurePhase: 'complete',
          error,
        });
        return outcomes;
      }
      outcomes.push({
        status: 'completed',
        reasons: currentReasons(),
        startedAtMs,
        finishedAtMs: Date.now(),
        fence: grant.fence,
        wakeGeneration: grant.wakeGeneration,
        handledGeneration: completion.handledGeneration,
        result,
      });
      if (completion.released) return outcomes;

      absorbPendingReasons();
      const renewed = this.#coordinator.renew(grant, this.#leaseTtlMs);
      if (renewed === null) {
        outcomes.push({
          status: 'failed',
          reasons: currentReasons(),
          startedAtMs: Date.now(),
          finishedAtMs: Date.now(),
          fence: grant.fence,
          wakeGeneration: completion.currentWakeGeneration,
          handledGeneration: completion.handledGeneration,
          failurePhase: 'complete',
          error: new StaleDesktopFenceError('lease renewal failed before trailing cycle'),
        });
        return outcomes;
      }
      grant = {
        ...renewed,
        wakeGeneration: completion.currentWakeGeneration,
        handledGeneration: completion.handledGeneration,
      };
    }
  }
}
