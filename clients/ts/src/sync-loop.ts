import type {
  Change,
  PullResponse,
  PushRequest,
  PushResponse,
  SnapshotRecord,
  SnapshotResponse,
} from './protocol.js';
import type { OptoSyncClient } from './client.js';

export interface ResetRequired {
  protocolVersion: 1;
  error: 'RESET_REQUIRED';
  snapshotUrl?: string;
}

/**
 * Network boundary for the background loop.
 *
 * Implementations own URL construction, authentication, token refresh, and
 * HTTP error mapping. Unknown transport failures are retried. Throw
 * [SyncTransportError] with `retryable: false` for an operator/user action
 * that must not spin in the background.
 */
export interface ProtocolTransport {
  push(request: PushRequest, signal: AbortSignal): Promise<PushResponse>;
  pull(
    checkpoint: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<PullResponse | ResetRequired>;
  snapshot(signal: AbortSignal, reset?: ResetRequired): Promise<SnapshotResponse>;
}

/**
 * Structural subset implemented by `OptoSyncClient`.
 *
 * Keeping this interface storage-neutral also permits an application to put
 * its authoritative rows and protocol metadata in one custom IndexedDB/SQLite
 * transaction.
 */
export interface ProtocolQueueAdapter {
  protocolPushRequest(limit?: number): Promise<PushRequest>;
  acknowledgePush(response: PushResponse, request: PushRequest): Promise<number>;
  pullCheckpoint(): Promise<string>;
  setPullCheckpoint(checkpoint: string): Promise<void>;
  installSnapshot(
    snapshot: SnapshotResponse,
    replaceAuthoritative: (
      records: readonly SnapshotRecord[],
    ) => Promise<void>,
  ): Promise<void>;
}

type Assert<T extends true> = T;
type _OptoSyncClientImplementsQueueAdapter = Assert<
  OptoSyncClient extends ProtocolQueueAdapter ? true : false
>;

export interface ProtocolSyncCallbacks {
  /**
   * Apply one commit-ordered pull page idempotently.
   *
   * The checkpoint is persisted only after this resolves. A crash between the
   * two operations replays the page, so use record revisions/upserts rather
   * than non-idempotent side effects.
   */
  applyChanges(changes: readonly Change[]): Promise<void>;
  /** Atomically replace the authoritative store during retention reset. */
  replaceAuthoritative(records: readonly SnapshotRecord[]): Promise<void>;
  /**
   * Optional same-store path: commit the page and checkpoint atomically.
   * The loop verifies that the queue adapter exposes the checkpoint on return.
   */
  applyChangesAndCheckpoint?(
    changes: readonly Change[],
    checkpoint: string,
  ): Promise<void>;
  /**
   * Optional same-store reset path: replace rows and commit the checkpoint in
   * one transaction. The loop verifies the checkpoint on return.
   */
  replaceAuthoritativeAndCheckpoint?(
    records: readonly SnapshotRecord[],
    checkpoint: string,
  ): Promise<void>;
}

export type ProtocolSyncStatus =
  | 'stopped'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'backoff'
  | 'error';

export interface ProtocolSyncState {
  status: ProtocolSyncStatus;
  consecutiveFailures: number;
  nextRetryAt?: number;
  lastError?: string;
}

export interface ProtocolSyncCycleResult {
  pushedMutations: number;
  acknowledgedMutations: number;
  pulledChanges: number;
  installedSnapshots: number;
  checkpoint: string;
  hasMorePending: boolean;
}

/** Cancellable timer handle used by the protocol scheduler. */
export interface ProtocolSyncTimer {
  cancel(): void;
}

/**
 * Injectable timer boundary for deterministic hosts and formal replay.
 * Production callers normally use the default platform timer.
 */
export type ProtocolSyncTimerFactory = (
  delayMs: number,
  callback: () => void,
) => ProtocolSyncTimer;

export interface ProtocolSyncLoopOptions {
  pushLimit?: number;
  pullLimit?: number;
  maxPushBatchesPerCycle?: number;
  maxPullPagesPerPhase?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  random?: () => number;
  now?: () => number;
  isOnline?: () => boolean;
  timerFactory?: ProtocolSyncTimerFactory;
  onStateChange?: (state: Readonly<ProtocolSyncState>) => void;
  /**
   * Disable browser `online` and `visibilitychange` listeners when an
   * application supplies its own lifecycle integration.
   */
  observeBrowserLifecycle?: boolean;
}

export class SyncTransportError extends Error {
  constructor(
    message: string,
    public readonly retryable = true,
    public readonly retryAfterMs?: number,
    public readonly code = 'SYNC_TRANSPORT_ERROR',
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

function integerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return resolved;
}

/** Full-jitter exponential backoff, with Retry-After treated as a floor. */
export function computeRetryDelay(
  consecutiveFailure: number,
  baseMs = 500,
  maxMs = 30_000,
  random: () => number = Math.random,
  retryAfterMs = 0,
): number {
  if (
    !Number.isInteger(consecutiveFailure) ||
    consecutiveFailure < 1 ||
    !Number.isFinite(baseMs) ||
    baseMs < 1 ||
    !Number.isFinite(maxMs) ||
    maxMs < baseMs ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0
  ) {
    throw new RangeError('invalid retry policy');
  }
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new RangeError('random() must return a number from 0 through 1');
  }
  const exponent = Math.min(consecutiveFailure - 1, 30);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);
  return Math.max(Math.ceil(ceiling * sample), Math.ceil(retryAfterMs));
}

function isResetRequired(value: PullResponse | ResetRequired): value is ResetRequired {
  return (value as ResetRequired).error === 'RESET_REQUIRED';
}

const canonicalDecimal = /^(?:0|[1-9]\d*)$/;
const positiveDecimal = /^[1-9]\d*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSnapshot(snapshot: SnapshotResponse, priorCheckpoint: string): void {
  if (
    snapshot.protocolVersion !== 1 ||
    !canonicalDecimal.test(snapshot.checkpoint) ||
    BigInt(snapshot.checkpoint) < BigInt(priorCheckpoint) ||
    !Array.isArray(snapshot.records) ||
    !snapshot.records.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.table === 'string' &&
        entry.table.length > 0 &&
        typeof entry.recordId === 'string' &&
        entry.recordId.length > 0 &&
        isRecord(entry.record) &&
        typeof entry.revision === 'string' &&
        positiveDecimal.test(entry.revision),
    )
  ) {
    throw new SyncTransportError('invalid protocol snapshot response', false);
  }
}

function validatePullPage(pulled: PullResponse, priorCheckpoint: string): void {
  if (
    pulled.protocolVersion !== 1 ||
    !canonicalDecimal.test(pulled.checkpoint) ||
    BigInt(pulled.checkpoint) < BigInt(priorCheckpoint) ||
    typeof pulled.hasMore !== 'boolean' ||
    !Array.isArray(pulled.changes)
  ) {
    throw new SyncTransportError('invalid protocol pull response', false);
  }

  let last = BigInt(priorCheckpoint);
  const pageCheckpoint = BigInt(pulled.checkpoint);
  for (const entry of pulled.changes) {
    if (
      !isRecord(entry) ||
      typeof entry.checkpoint !== 'string' ||
      !positiveDecimal.test(entry.checkpoint) ||
      BigInt(entry.checkpoint) <= last ||
      BigInt(entry.checkpoint) > pageCheckpoint ||
      typeof entry.table !== 'string' ||
      entry.table.length === 0 ||
      typeof entry.recordId !== 'string' ||
      entry.recordId.length === 0 ||
      (entry.operation !== 'upsert' && entry.operation !== 'delete') ||
      (entry.operation === 'upsert' ? !isRecord(entry.record) : entry.record !== null) ||
      typeof entry.revision !== 'string' ||
      !positiveDecimal.test(entry.revision) ||
      (entry.source !== undefined &&
        (!isRecord(entry.source) ||
          typeof entry.source.clientId !== 'string' ||
          entry.source.clientId.length === 0 ||
          typeof entry.source.mutationId !== 'string' ||
          !positiveDecimal.test(entry.source.mutationId)))
    ) {
      throw new SyncTransportError('invalid protocol pull change', false);
    }
    last = BigInt(entry.checkpoint);
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

const systemTimerFactory: ProtocolSyncTimerFactory = (delayMs, callback) => {
  const handle = setTimeout(callback, delayMs);
  return { cancel: () => clearTimeout(handle) };
};

/**
 * Single-flight, transport-neutral protocol v1 background synchronization.
 *
 * One cycle catches up from the server, uploads immutable queue snapshots,
 * then catches up again. Live/WebSocket/Realtime messages should call
 * `hint()`; they are wake-up hints, never the source of truth.
 */
export class ProtocolSyncLoop {
  private readonly pushLimit: number;
  private readonly pullLimit: number;
  private readonly maxPushBatches: number;
  private readonly maxPullPages: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly timerFactory: ProtocolSyncTimerFactory;
  private readonly observeBrowserLifecycle: boolean;
  private stateValue: ProtocolSyncState = {
    status: 'stopped',
    consecutiveFailures: 0,
  };
  private timer: ProtocolSyncTimer | undefined;
  private inFlight: Promise<ProtocolSyncCycleResult> | undefined;
  private abortController: AbortController | undefined;
  private started = false;
  private rerunRequested = false;
  private generation = 0;
  private readonly onlineListener = () => this.hint();
  private readonly offlineListener = () => this.hint();
  private readonly visibilityListener = () => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState === 'visible'
    ) {
      this.hint();
    }
  };

  constructor(
    private readonly queue: ProtocolQueueAdapter,
    private readonly transport: ProtocolTransport,
    private readonly callbacks: ProtocolSyncCallbacks,
    private readonly options: ProtocolSyncLoopOptions = {},
  ) {
    this.pushLimit = integerOption(options.pushLimit, 100, 1, 100, 'pushLimit');
    this.pullLimit = integerOption(options.pullLimit, 100, 1, 1000, 'pullLimit');
    this.maxPushBatches = integerOption(
      options.maxPushBatchesPerCycle,
      10,
      1,
      1000,
      'maxPushBatchesPerCycle',
    );
    this.maxPullPages = integerOption(
      options.maxPullPagesPerPhase,
      100,
      1,
      10_000,
      'maxPullPagesPerPhase',
    );
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
    computeRetryDelay(1, this.retryBaseMs, this.retryMaxMs, () => 0);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.isOnline =
      options.isOnline ??
      (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.timerFactory = options.timerFactory ?? systemTimerFactory;
    this.observeBrowserLifecycle = options.observeBrowserLifecycle !== false;
  }

  get state(): Readonly<ProtocolSyncState> {
    return { ...this.stateValue };
  }

  start(): void {
    if (this.started) return;
    this.generation += 1;
    this.started = true;
    if (this.observeBrowserLifecycle) {
      globalThis.addEventListener?.('online', this.onlineListener);
      globalThis.addEventListener?.('offline', this.offlineListener);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.visibilityListener);
      }
    }
    if (!this.isOnline()) {
      this.transition({
        status: 'offline',
        consecutiveFailures: 0,
        nextRetryAt: undefined,
      });
      return;
    }
    this.stateValue.consecutiveFailures = 0;
    this.transition({ status: 'idle', nextRetryAt: undefined });
    this.schedule(0);
  }

  stop(): void {
    this.generation += 1;
    this.started = false;
    this.rerunRequested = false;
    this.timer?.cancel();
    this.timer = undefined;
    this.abortController?.abort();
    if (this.observeBrowserLifecycle) {
      globalThis.removeEventListener?.('online', this.onlineListener);
      globalThis.removeEventListener?.('offline', this.offlineListener);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityListener);
      }
    }
    this.transition({ status: 'stopped', nextRetryAt: undefined });
  }

  /**
   * Wake the loop after a local write, connectivity change, or live-event hint.
   * Concurrent hints coalesce; no second push can race the active one.
   */
  hint(): void {
    if (!this.started) return;
    if (!this.isOnline()) {
      this.enterOffline();
      return;
    }
    if (this.stateValue.status === 'offline') {
      this.transition({ status: 'idle', nextRetryAt: undefined });
    }
    this.rerunRequested = true;
    if (this.inFlight) return;
    this.timer?.cancel();
    this.timer = undefined;
    this.schedule(0);
  }

  /** Run one cycle now. Concurrent callers share the same promise. */
  syncNow(): Promise<ProtocolSyncCycleResult> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    const controller = new AbortController();
    const generation = this.generation;
    this.abortController = controller;
    this.transition({ status: 'syncing', nextRetryAt: undefined, lastError: undefined });
    const running = this.performCycle(controller.signal)
      .then((result) => {
        if (generation !== this.generation) return result;
        this.stateValue.consecutiveFailures = 0;
        this.transition({
          status: this.started ? 'idle' : 'stopped',
          consecutiveFailures: 0,
          nextRetryAt: undefined,
          lastError: undefined,
        });
        return result;
      })
      .catch((error) => {
        if (generation === this.generation) {
          this.transition({
            status: this.started ? 'error' : 'stopped',
            lastError: safeError(error),
            nextRetryAt: undefined,
          });
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight === running) this.inFlight = undefined;
        if (this.abortController === controller) this.abortController = undefined;
        if (
          generation !== this.generation &&
          this.started &&
          this.isOnline() &&
          this.rerunRequested
        ) {
          this.schedule(0);
        }
      });
    this.inFlight = running;
    return running;
  }

  private async performCycle(signal: AbortSignal): Promise<ProtocolSyncCycleResult> {
    const result: ProtocolSyncCycleResult = {
      pushedMutations: 0,
      acknowledgedMutations: 0,
      pulledChanges: 0,
      installedSnapshots: 0,
      checkpoint: await this.queue.pullCheckpoint(),
      hasMorePending: false,
    };

    await this.pullToCurrent(signal, result);

    for (let batch = 0; batch < this.maxPushBatches; batch += 1) {
      const request = await this.queue.protocolPushRequest(this.pushLimit);
      if (request.mutations.length === 0) break;
      const response = await this.transport.push(request, signal);
      result.pushedMutations += request.mutations.length;
      result.acknowledgedMutations += await this.queue.acknowledgePush(
        response,
        request,
      );
    }

    const remaining = await this.queue.protocolPushRequest(1);
    result.hasMorePending = remaining.mutations.length > 0;
    await this.pullToCurrent(signal, result);
    result.checkpoint = await this.queue.pullCheckpoint();
    return result;
  }

  private async pullToCurrent(
    signal: AbortSignal,
    result: ProtocolSyncCycleResult,
  ): Promise<void> {
    for (let page = 0; page < this.maxPullPages; page += 1) {
      const checkpoint = await this.queue.pullCheckpoint();
      const pulled = await this.transport.pull(checkpoint, this.pullLimit, signal);
      if (isResetRequired(pulled)) {
        if (pulled.protocolVersion !== 1) {
          throw new SyncTransportError('invalid protocol reset response', false);
        }
        const snapshot = await this.transport.snapshot(signal, pulled);
        validateSnapshot(snapshot, checkpoint);
        if (this.callbacks.replaceAuthoritativeAndCheckpoint) {
          await this.callbacks.replaceAuthoritativeAndCheckpoint(
            snapshot.records,
            snapshot.checkpoint,
          );
          if ((await this.queue.pullCheckpoint()) !== snapshot.checkpoint) {
            throw new SyncTransportError(
              'atomic snapshot callback did not persist its checkpoint',
              false,
            );
          }
        } else {
          await this.queue.installSnapshot(
            snapshot,
            this.callbacks.replaceAuthoritative,
          );
        }
        result.installedSnapshots += 1;
        continue;
      }
      validatePullPage(pulled, checkpoint);
      if (this.callbacks.applyChangesAndCheckpoint) {
        await this.callbacks.applyChangesAndCheckpoint(
          pulled.changes,
          pulled.checkpoint,
        );
        if ((await this.queue.pullCheckpoint()) !== pulled.checkpoint) {
          throw new SyncTransportError(
            'atomic pull callback did not persist its checkpoint',
            false,
          );
        }
      } else {
        if (pulled.changes.length > 0) {
          await this.callbacks.applyChanges(pulled.changes);
        }
        await this.queue.setPullCheckpoint(pulled.checkpoint);
      }
      result.pulledChanges += pulled.changes.length;
      if (!pulled.hasMore) return;
      if (pulled.checkpoint === checkpoint) {
        throw new SyncTransportError(
          'pull response hasMore without checkpoint progress',
          false,
        );
      }
    }
    throw new SyncTransportError('pull page safety limit exceeded', false);
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.timer !== undefined) return;
    const generation = this.generation;
    let scheduled: ProtocolSyncTimer;
    scheduled = this.timerFactory(delayMs, () => {
      const isCurrent = this.timer === scheduled;
      if (isCurrent) this.timer = undefined;
      if (!isCurrent || generation !== this.generation || !this.started) return;
      void this.drive(generation);
    });
    this.timer = scheduled;
  }

  private async drive(generation: number): Promise<void> {
    if (!this.started || generation !== this.generation) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    if (!this.isOnline()) {
      this.enterOffline();
      return;
    }
    this.rerunRequested = false;
    try {
      const result = await this.syncNow();
      if (generation !== this.generation) return;
      if (this.started && (this.rerunRequested || result.hasMorePending)) {
        this.schedule(0);
      }
    } catch (error) {
      if (
        !this.started ||
        generation !== this.generation ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return;
      }
      if (error instanceof SyncTransportError && !error.retryable) {
        this.transition({ status: 'error', nextRetryAt: undefined });
        return;
      }
      const failures = Math.min(this.stateValue.consecutiveFailures + 1, 31);
      const retryAfter =
        error instanceof SyncTransportError ? error.retryAfterMs ?? 0 : 0;
      const delay = computeRetryDelay(
        failures,
        this.retryBaseMs,
        this.retryMaxMs,
        this.random,
        retryAfter,
      );
      this.transition({
        status: 'backoff',
        consecutiveFailures: failures,
        nextRetryAt: this.now() + delay,
        lastError: safeError(error),
      });
      this.schedule(delay);
    }
  }

  private enterOffline(): void {
    if (!this.started || this.stateValue.status === 'offline') return;
    this.generation += 1;
    this.rerunRequested = false;
    this.timer?.cancel();
    this.timer = undefined;
    this.abortController?.abort();
    this.transition({ status: 'offline', nextRetryAt: undefined });
  }

  private transition(patch: Partial<ProtocolSyncState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    try {
      this.options.onStateChange?.({ ...this.stateValue });
    } catch {
      // Observability callbacks must never stop synchronization.
    }
  }
}
