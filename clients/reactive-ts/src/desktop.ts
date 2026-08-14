export type DesktopWakeReason =
  | 'process-start'
  | 'local-mutation'
  | 'remote-change'
  | 'connectivity'
  | 'resume'
  | 'app-update'
  | 'manual';

export type DesktopRuntime =
  | 'node'
  | 'electron'
  | 'flutter'
  | 'rust-native'
  | 'wasm-webview';

export type DesktopExecutionClass =
  | 'persistent-native-runner'
  | 'service-worker-events'
  | 'foreground-only';

export type DesktopTcpCapability =
  | 'native'
  | 'host-bridge'
  | 'unsupported';

export interface DesktopCapabilityInput {
  runtime: DesktopRuntime;
  serviceWorkerAvailable?: boolean;
  nativeHostBridgeAvailable?: boolean;
  persistentNativeRunnerAvailable?: boolean;
  tcpAvailable?: boolean;
}

export interface DesktopSyncCapability {
  runtime: DesktopRuntime;
  executionClass: DesktopExecutionClass;
  http: true;
  websocketLifetime: 'host-process' | 'foreground';
  tcp: DesktopTcpCapability;
  survivesWindowClosure: boolean;
  survivesHostTermination: boolean;
  exactIntervalsGuaranteed: false;
}

/**
 * Describe what a concrete desktop host can honestly promise.
 *
 * WASM does not become an operating-system daemon merely because it is loaded
 * by a desktop webview. A native bridge may supply a persistent runner or TCP,
 * but the capability is then attributed to that host bridge, not to WASM.
 */
export function resolveDesktopSyncCapability(
  input: DesktopCapabilityInput,
): DesktopSyncCapability {
  const serviceWorkerAvailable = input.serviceWorkerAvailable === true;
  const nativeHostBridgeAvailable = input.nativeHostBridgeAvailable === true;
  const persistentNativeRunnerAvailable =
    input.persistentNativeRunnerAvailable === true;

  if (
    input.runtime === 'wasm-webview' &&
    persistentNativeRunnerAvailable &&
    !nativeHostBridgeAvailable
  ) {
    throw new Error(
      'a WASM webview needs a native host bridge to claim a persistent runner',
    );
  }

  const executionClass: DesktopExecutionClass = persistentNativeRunnerAvailable
    ? 'persistent-native-runner'
    : serviceWorkerAvailable
      ? 'service-worker-events'
      : 'foreground-only';

  let tcp: DesktopTcpCapability = 'unsupported';
  if (input.tcpAvailable === true) {
    tcp =
      input.runtime === 'wasm-webview'
        ? nativeHostBridgeAvailable
          ? 'host-bridge'
          : 'unsupported'
        : 'native';
  }

  return {
    runtime: input.runtime,
    executionClass,
    http: true,
    websocketLifetime:
      executionClass === 'persistent-native-runner'
        ? 'host-process'
        : 'foreground',
    tcp,
    survivesWindowClosure:
      executionClass === 'persistent-native-runner' || serviceWorkerAvailable,
    survivesHostTermination: executionClass === 'persistent-native-runner',
    exactIntervalsGuaranteed: false,
  };
}

export interface DesktopLeaseRequest {
  key: string;
  ownerId: string;
  token: string;
  nowMs: number;
  expiresAtMs: number;
}

export interface DesktopLeaseGrant extends DesktopLeaseRequest {
  /** Monotonically increasing, lossless fencing identity assigned by the store. */
  fence: string;
}

/**
 * Durable cross-process lease boundary.
 *
 * `tryAcquire` must be atomic and increment `fence` whenever it replaces an
 * absent or expired lease. `release` must compare token + fence and must never
 * delete a newer owner's lease. The final correctness boundary remains server
 * deduplication by `(clientId, mutationId)`.
 */
export interface DesktopLeaseStore {
  tryAcquire(request: DesktopLeaseRequest): Promise<DesktopLeaseGrant | null>;
  release(grant: DesktopLeaseGrant): Promise<void>;
}

export interface DesktopSyncCycleContext {
  signal: AbortSignal;
  reasons: readonly DesktopWakeReason[];
  ownerId: string;
  leaseKey: string;
  fence: string;
  deadlineMs: number;
}

export type DesktopSyncCycle<R> = (
  context: DesktopSyncCycleContext,
) => Promise<R>;

export type DesktopSyncOutcomeStatus =
  | 'completed'
  | 'busy'
  | 'cancelled'
  | 'failed';
export type DesktopSyncFailurePhase = 'acquire' | 'cycle' | 'release';

export interface DesktopSyncOutcome<R> {
  status: DesktopSyncOutcomeStatus;
  reasons: readonly DesktopWakeReason[];
  startedAtMs: number;
  finishedAtMs: number;
  fence?: string;
  result?: R;
  failurePhase?: DesktopSyncFailurePhase;
  error?: unknown;
}

export interface DesktopSyncDrainResult<R> {
  outcomes: readonly DesktopSyncOutcome<R>[];
}

export interface DesktopSyncRunnerOptions<R> {
  leaseStore: DesktopLeaseStore;
  leaseKey: string;
  ownerId: string;
  syncOnce: DesktopSyncCycle<R>;
  timeoutMs?: number;
  leaseTtlMs?: number;
  now?: () => number;
  tokenFactory?: () => string;
  onOutcome?: (outcome: DesktopSyncOutcome<R>) => void;
}

function validateIdentifier(name: string, value: string): void {
  if (!value || value.length > 512) {
    throw new RangeError(`${name} must be 1 through 512 characters`);
  }
}

function defaultTokenFactory(): string {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error(
      'desktop sync needs crypto.randomUUID or an explicit tokenFactory',
    );
  }
  return crypto.randomUUID();
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Serialize desktop wake bursts around one bounded, durably fenced cycle.
 *
 * Wakes received while a cycle is running are coalesced into one trailing
 * cycle. This avoids stranding a mutation committed just after the active
 * cycle inspected its durable queue. The callback must observe `signal`; the
 * runner never releases its lease behind a callback that is still executing.
 * Multiple processes still need a durable `DesktopLeaseStore`; in-memory
 * single-flight alone is not a correctness boundary.
 */
export class DesktopSyncRunner<R> {
  readonly #leaseStore: DesktopLeaseStore;
  readonly #leaseKey: string;
  readonly #ownerId: string;
  readonly #syncOnce: DesktopSyncCycle<R>;
  readonly #timeoutMs: number;
  readonly #leaseTtlMs: number;
  readonly #now: () => number;
  readonly #tokenFactory: () => string;
  readonly #onOutcome?: (outcome: DesktopSyncOutcome<R>) => void;
  readonly #pendingReasons = new Set<DesktopWakeReason>();
  #drain?: Promise<DesktopSyncDrainResult<R>>;
  #activeController?: AbortController;
  readonly #lifecycle = new SyncLifecycleMachine();

  constructor(options: DesktopSyncRunnerOptions<R>) {
    validateIdentifier('leaseKey', options.leaseKey);
    validateIdentifier('ownerId', options.ownerId);
    const timeoutMs = options.timeoutMs ?? 25_000;
    const leaseTtlMs = options.leaseTtlMs ?? timeoutMs + 5_000;
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > 10 * 60_000
    ) {
      throw new RangeError('timeoutMs must be from 1000 through 600000');
    }
    if (
      !Number.isFinite(leaseTtlMs) ||
      leaseTtlMs < timeoutMs + 1_000 ||
      leaseTtlMs > 15 * 60_000
    ) {
      throw new RangeError(
        'leaseTtlMs must cover timeoutMs plus 1000ms and be at most 900000',
      );
    }
    this.#leaseStore = options.leaseStore;
    this.#leaseKey = options.leaseKey;
    this.#ownerId = options.ownerId;
    this.#syncOnce = options.syncOnce;
    this.#timeoutMs = timeoutMs;
    this.#leaseTtlMs = leaseTtlMs;
    this.#now = options.now ?? Date.now;
    this.#tokenFactory = options.tokenFactory ?? defaultTokenFactory;
    this.#onOutcome = options.onOutcome;
  }

  get closed(): boolean {
    return (
      this.#lifecycle.state.phase === 'closed' ||
      this.#lifecycle.state.closeRequested
    );
  }

  get lifecycle(): SyncLifecycleSnapshot {
    return this.#lifecycle.state;
  }

  wake(
    reason: DesktopWakeReason = 'manual',
  ): Promise<DesktopSyncDrainResult<R>> {
    if (this.closed) {
      return Promise.reject(new Error('desktop sync runner is closed'));
    }
    this.#pendingReasons.add(reason);
    this.#lifecycle.apply('wake');
    if (this.#drain) return this.#drain;

    const running = this.#drainPending().finally(() => {
      if (this.#drain === running) this.#drain = undefined;
    });
    this.#drain = running;
    return running;
  }

  runNow(): Promise<DesktopSyncDrainResult<R>> {
    return this.wake('manual');
  }

  close(): void {
    if (this.closed) return;
    this.#lifecycle.apply('close');
    this.#pendingReasons.clear();
    this.#activeController?.abort(
      abortError('desktop sync runner closed during an active cycle'),
    );
  }

  async #drainPending(): Promise<DesktopSyncDrainResult<R>> {
    const outcomes: DesktopSyncOutcome<R>[] = [];
    while (!this.closed && this.#pendingReasons.size > 0) {
      const reasons = [...this.#pendingReasons].sort();
      this.#pendingReasons.clear();
      const outcome = await this.#runCycle(reasons);
      outcomes.push(outcome);
      this.#onOutcome?.(outcome);
    }
    return { outcomes };
  }

  async #runCycle(
    reasons: readonly DesktopWakeReason[],
  ): Promise<DesktopSyncOutcome<R>> {
    const startedAtMs = this.#now();
    const token = this.#tokenFactory();
    validateIdentifier('tokenFactory result', token);
    this.#lifecycle.apply('begin-acquire');
    let grant: DesktopLeaseGrant | null;
    try {
      grant = await this.#leaseStore.tryAcquire({
        key: this.#leaseKey,
        ownerId: this.#ownerId,
        token,
        nowMs: startedAtMs,
        expiresAtMs: startedAtMs + this.#leaseTtlMs,
      });
    } catch (error) {
      this.#lifecycle.apply('acquire-deferred');
      return {
        status: 'failed',
        reasons,
        startedAtMs,
        finishedAtMs: this.#now(),
        failurePhase: 'acquire',
        error,
      };
    }

    if (grant === null) {
      this.#lifecycle.apply('acquire-deferred');
      return {
        status: 'busy',
        reasons,
        startedAtMs,
        finishedAtMs: this.#now(),
      };
    }

    this.#lifecycle.apply('acquire-granted');
    if (this.#lifecycle.state.phase === 'releasing') {
      let releaseError: unknown;
      try {
        await this.#leaseStore.release(grant);
      } catch (error) {
        releaseError = error;
      } finally {
        this.#lifecycle.apply('release-settled');
      }
      return {
        status: releaseError === undefined ? 'cancelled' : 'failed',
        reasons,
        startedAtMs,
        finishedAtMs: this.#now(),
        fence: grant.fence,
        failurePhase: releaseError === undefined ? undefined : 'release',
        error: releaseError,
      };
    }

    const controller = new AbortController();
    this.#activeController = controller;
    const deadlineMs = startedAtMs + this.#timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: R | undefined;
    let cycleError: unknown;
    try {
      const operation = Promise.resolve().then(() =>
        this.#syncOnce({
          signal: controller.signal,
          reasons,
          ownerId: this.#ownerId,
          leaseKey: this.#leaseKey,
          fence: grant.fence,
          deadlineMs,
        }),
      );
      timer = setTimeout(() => {
        controller.abort(abortError('opto-sync desktop cycle timed out'));
        this.#lifecycle.apply('cancel');
      }, this.#timeoutMs);
      result = await operation;
      if (controller.signal.aborted) {
        throw (
          controller.signal.reason ??
          abortError('opto-sync desktop cycle was aborted')
        );
      }
    } catch (error) {
      cycleError = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (this.#activeController === controller) {
        this.#activeController = undefined;
      }
      this.#lifecycle.apply('cycle-settled');
    }

    let releaseError: unknown;
    try {
      await this.#leaseStore.release(grant);
    } catch (error) {
      releaseError = error;
    } finally {
      this.#lifecycle.apply('release-settled');
    }

    if (cycleError !== undefined) {
      return {
        status: 'failed',
        reasons,
        startedAtMs,
        finishedAtMs: this.#now(),
        fence: grant.fence,
        failurePhase: 'cycle',
        error: cycleError,
      };
    }
    if (releaseError !== undefined) {
      return {
        status: 'failed',
        reasons,
        startedAtMs,
        finishedAtMs: this.#now(),
        fence: grant.fence,
        result,
        failurePhase: 'release',
        error: releaseError,
      };
    }
    return {
      status: 'completed',
      reasons,
      startedAtMs,
      finishedAtMs: this.#now(),
      fence: grant.fence,
      result,
    };
  }
}

/**
 * Deterministic lease store for tests and single-process demonstrations only.
 * Production desktop hosts must persist the same compare-and-swap contract in
 * SQLite or another store shared by every process that can drain the queue.
 */
export class InMemoryDesktopLeaseStore implements DesktopLeaseStore {
  readonly #leases = new Map<string, DesktopLeaseGrant>();
  readonly #fences = new Map<string, bigint>();

  async tryAcquire(
    request: DesktopLeaseRequest,
  ): Promise<DesktopLeaseGrant | null> {
    const current = this.#leases.get(request.key);
    if (current && current.expiresAtMs > request.nowMs) return null;
    const fence = (this.#fences.get(request.key) ?? 0n) + 1n;
    this.#fences.set(request.key, fence);
    const grant: DesktopLeaseGrant = {
      ...request,
      fence: fence.toString(),
    };
    this.#leases.set(request.key, grant);
    return grant;
  }

  async release(grant: DesktopLeaseGrant): Promise<void> {
    const current = this.#leases.get(grant.key);
    if (
      current &&
      current.token === grant.token &&
      current.fence === grant.fence
    ) {
      this.#leases.delete(grant.key);
    }
  }
}
import {
  SyncLifecycleMachine,
  type SyncLifecycleSnapshot,
} from './sync-lifecycle.ts';
