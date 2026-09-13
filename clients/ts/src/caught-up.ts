import type {
  ProtocolQueueAdapter,
  ProtocolSyncCycleResult,
  ProtocolSyncState,
} from './sync-loop.js';

const CANONICAL_CHECKPOINT = /^(?:0|[1-9]\d*)$/;

/**
 * An authoritative source position representing all changes committed before
 * the checkpoint request completed.
 *
 * `generation` is optional in protocol-v1 so existing full-replication servers
 * can adopt the barrier without inventing scope semantics. Selective-sync
 * scopes must bind it once scope identity lands (DEN-139).
 */
export interface AuthoritativeCheckpointTarget {
  protocolVersion: 1;
  checkpoint: string;
  generation?: string;
}

/** Optional transport capability; deliberately separate from ProtocolTransport. */
export interface AuthoritativeCheckpointRequester {
  requestCheckpoint(signal: AbortSignal): Promise<AuthoritativeCheckpointTarget>;
}

/** Structural sync-loop surface used by the barrier. */
export interface CaughtUpSyncLoop {
  readonly state?: Readonly<ProtocolSyncState>;
  syncNow(): Promise<ProtocolSyncCycleResult>;
}

export interface AwaitCaughtUpOptions {
  /** Bound the caller's wait. The shared sync cycle itself is never aborted. */
  timeoutMs?: number;
  /** Cancels this waiter only; it never cancels another waiter/background sync. */
  signal?: AbortSignal;
  /** Poll delay when a successful cycle made no checkpoint progress. */
  pollIntervalMs?: number;
  /** Override connectivity detection for non-browser hosts/tests. */
  isOnline?: () => boolean;
  /** Expected checkpoint namespace/reset/scope generation, when one exists. */
  expectedGeneration?: string;
  /** Injectable monotonic-ish wall clock for elapsed-time reporting/tests. */
  now?: () => number;
}

export type CaughtUpBarrierErrorCode =
  | 'CAUGHT_UP_INVALID_TARGET'
  | 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT'
  | 'CAUGHT_UP_INVALIDATED'
  | 'CAUGHT_UP_TIMEOUT'
  | 'CAUGHT_UP_CANCELLED'
  | 'CAUGHT_UP_OFFLINE';

export class CaughtUpBarrierError extends Error {
  constructor(
    public readonly code: CaughtUpBarrierErrorCode,
    message: string,
    public readonly targetCheckpoint?: string,
    public readonly localCheckpoint?: string,
  ) {
    super(message);
    this.name = 'CaughtUpBarrierError';
  }
}

export interface CaughtUpResult {
  targetCheckpoint: string;
  checkpoint: string;
  generation?: string;
  elapsedMs: number;
  cycles: number;
  alreadyCaughtUp: boolean;
}

function assertCheckpoint(
  checkpoint: string,
  code: 'CAUGHT_UP_INVALID_TARGET' | 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT',
): void {
  if (!CANONICAL_CHECKPOINT.test(checkpoint)) {
    throw new CaughtUpBarrierError(
      code,
      `${code === 'CAUGHT_UP_INVALID_TARGET' ? 'target' : 'local'} checkpoint must be a canonical unsigned decimal string`,
      code === 'CAUGHT_UP_INVALID_TARGET' ? checkpoint : undefined,
      code === 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT' ? checkpoint : undefined,
    );
  }
}

export function checkpointReached(local: string, target: string): boolean {
  assertCheckpoint(local, 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT');
  assertCheckpoint(target, 'CAUGHT_UP_INVALID_TARGET');
  return BigInt(local) >= BigInt(target);
}

export function validateAuthoritativeCheckpointTarget(
  target: AuthoritativeCheckpointTarget,
  expectedGeneration?: string,
): void {
  if (target.protocolVersion !== 1) {
    throw new CaughtUpBarrierError(
      'CAUGHT_UP_INVALID_TARGET',
      'authoritative checkpoint target has unsupported protocolVersion',
      target.checkpoint,
    );
  }
  assertCheckpoint(target.checkpoint, 'CAUGHT_UP_INVALID_TARGET');
  if (target.generation !== undefined && target.generation.length === 0) {
    throw new CaughtUpBarrierError(
      'CAUGHT_UP_INVALID_TARGET',
      'authoritative checkpoint generation must be non-empty when present',
      target.checkpoint,
    );
  }
  if (
    expectedGeneration !== undefined &&
    target.generation !== expectedGeneration
  ) {
    throw new CaughtUpBarrierError(
      'CAUGHT_UP_INVALIDATED',
      `checkpoint generation ${JSON.stringify(target.generation ?? null)} does not match expected generation ${JSON.stringify(expectedGeneration)}`,
      target.checkpoint,
    );
  }
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function callerCancelled(target: string, local?: string): CaughtUpBarrierError {
  return new CaughtUpBarrierError(
    'CAUGHT_UP_CANCELLED',
    'caught-up wait was cancelled',
    target,
    local,
  );
}

function callerTimedOut(target: string, local?: string): CaughtUpBarrierError {
  return new CaughtUpBarrierError(
    'CAUGHT_UP_TIMEOUT',
    'caught-up wait timed out before the durable checkpoint reached the target',
    target,
    local,
  );
}

/**
 * Wait for one promise while bounding only this caller.
 *
 * Deliberately does not abort `promise`: when it is ProtocolSyncLoop.syncNow(),
 * that promise may be shared by background work and other caught-up waiters.
 */
function waitForCaller<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  target: string,
  local?: string,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(callerCancelled(target, local));
  if (timeoutMs <= 0) return Promise.reject(callerTimedOut(target, local));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () =>
      finish(() => reject(callerCancelled(target, local)));
    const timer = setTimeout(
      () => finish(() => reject(callerTimedOut(target, local))),
      timeoutMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function delayForCaller(
  delayMs: number,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  target: string,
  local: string,
): Promise<void> {
  return waitForCaller(
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
    signal,
    timeoutMs,
    target,
    local,
  );
}

/**
 * Drive the ordinary single-flight sync loop until its *durable* checkpoint is
 * at or beyond `target.checkpoint`.
 *
 * `idle`, a WebSocket wake, or a successful network response is never treated
 * as freshness evidence. Completion is decided only by rereading
 * `queue.pullCheckpoint()` after synchronization.
 */
export async function awaitCaughtUp(
  loop: CaughtUpSyncLoop,
  queue: Pick<ProtocolQueueAdapter, 'pullCheckpoint'>,
  target: AuthoritativeCheckpointTarget,
  options: AwaitCaughtUpOptions = {},
): Promise<CaughtUpResult> {
  validateAuthoritativeCheckpointTarget(target, options.expectedGeneration);
  const now = options.now ?? Date.now;
  const timeoutMs = finiteNonNegative(options.timeoutMs ?? 30_000, 'timeoutMs');
  const pollIntervalMs = finiteNonNegative(
    options.pollIntervalMs ?? 50,
    'pollIntervalMs',
  );
  const isOnline =
    options.isOnline ??
    (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let checkpoint = await queue.pullCheckpoint();
  assertCheckpoint(checkpoint, 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT');

  if (checkpointReached(checkpoint, target.checkpoint)) {
    return {
      targetCheckpoint: target.checkpoint,
      checkpoint,
      generation: target.generation,
      elapsedMs: Math.max(0, now() - startedAt),
      cycles: 0,
      alreadyCaughtUp: true,
    };
  }

  let cycles = 0;
  for (;;) {
    if (options.signal?.aborted) {
      throw callerCancelled(target.checkpoint, checkpoint);
    }
    if (!isOnline() || loop.state?.status === 'offline') {
      throw new CaughtUpBarrierError(
        'CAUGHT_UP_OFFLINE',
        'cannot establish authoritative freshness while offline',
        target.checkpoint,
        checkpoint,
      );
    }
    const remaining = deadline - now();
    if (remaining <= 0) throw callerTimedOut(target.checkpoint, checkpoint);

    const before = checkpoint;
    await waitForCaller(
      loop.syncNow(),
      options.signal,
      remaining,
      target.checkpoint,
      checkpoint,
    );
    cycles += 1;

    // The durable store is the evidence. Never trust the cycle's in-memory
    // result checkpoint here: an application adapter may have failed to persist.
    checkpoint = await queue.pullCheckpoint();
    assertCheckpoint(checkpoint, 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT');
    if (checkpointReached(checkpoint, target.checkpoint)) {
      return {
        targetCheckpoint: target.checkpoint,
        checkpoint,
        generation: target.generation,
        elapsedMs: Math.max(0, now() - startedAt),
        cycles,
        alreadyCaughtUp: false,
      };
    }

    if (checkpoint === before && pollIntervalMs > 0) {
      const afterCycleRemaining = deadline - now();
      if (afterCycleRemaining <= 0) {
        throw callerTimedOut(target.checkpoint, checkpoint);
      }
      await delayForCaller(
        Math.min(pollIntervalMs, afterCycleRemaining),
        options.signal,
        afterCycleRemaining,
        target.checkpoint,
        checkpoint,
      );
    }
  }
}

/**
 * Ask the server for a source position representing "now", then wait until the
 * durable local checkpoint reaches it. Timeout covers both phases.
 */
export async function requestAndAwaitCaughtUp(
  loop: CaughtUpSyncLoop,
  queue: Pick<ProtocolQueueAdapter, 'pullCheckpoint'>,
  requester: AuthoritativeCheckpointRequester,
  options: AwaitCaughtUpOptions = {},
): Promise<CaughtUpResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = finiteNonNegative(options.timeoutMs ?? 30_000, 'timeoutMs');
  const startedAt = now();
  const requestController = new AbortController();
  const onAbort = () => requestController.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const target = await waitForCaller(
      requester.requestCheckpoint(requestController.signal),
      options.signal,
      timeoutMs,
      '0',
    ).catch((error) => {
      if (
        error instanceof CaughtUpBarrierError &&
        (error.code === 'CAUGHT_UP_TIMEOUT' ||
          error.code === 'CAUGHT_UP_CANCELLED')
      ) {
        requestController.abort();
      }
      throw error;
    });
    const elapsed = Math.max(0, now() - startedAt);
    return awaitCaughtUp(loop, queue, target, {
      ...options,
      timeoutMs: Math.max(0, timeoutMs - elapsed),
      now,
    });
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
