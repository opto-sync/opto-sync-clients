import type {
  ProtocolQueueAdapter,
  ProtocolSyncCycleResult,
  ProtocolSyncState,
} from '../sync-loop.js';
import { systemCaughtUpNow } from '../runtime/caught-up-clock.js';

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
  /** Injectable wall clock for elapsed-time reporting/tests. */
  now?: () => number;
}

export type CaughtUpBarrierErrorCode =
  | 'CAUGHT_UP_INVALID_TARGET'
  | 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT'
  | 'CAUGHT_UP_INVALIDATED'
  | 'CAUGHT_UP_TIMEOUT'
  | 'CAUGHT_UP_CANCELLED'
  | 'CAUGHT_UP_OFFLINE';

export interface CaughtUpBarrierFailure {
  kind: 'barrier';
  code: CaughtUpBarrierErrorCode;
  message: string;
  targetCheckpoint?: string;
  localCheckpoint?: string;
}

export interface CaughtUpSyncFailure {
  kind: 'sync';
  message: string;
  cause: unknown;
  targetCheckpoint: string;
  localCheckpoint: string;
}

export interface CaughtUpRequestFailure {
  kind: 'request';
  message: string;
  cause: unknown;
}

export type CaughtUpFailure =
  | CaughtUpBarrierFailure
  | CaughtUpSyncFailure
  | CaughtUpRequestFailure;

export interface CaughtUpResult {
  targetCheckpoint: string;
  checkpoint: string;
  generation?: string;
  elapsedMs: number;
  cycles: number;
  alreadyCaughtUp: boolean;
}

export type CaughtUpOutcome<T = CaughtUpResult> =
  | { ok: true; value: T }
  | { ok: false; error: CaughtUpFailure };

const success = <T>(value: T): CaughtUpOutcome<T> => ({ ok: true, value });
const failure = <T = never>(error: CaughtUpFailure): CaughtUpOutcome<T> => ({
  ok: false,
  error,
});

function barrierFailure(
  code: CaughtUpBarrierErrorCode,
  message: string,
  targetCheckpoint?: string,
  localCheckpoint?: string,
): CaughtUpBarrierFailure {
  return {
    kind: 'barrier',
    code,
    message,
    ...(targetCheckpoint === undefined ? {} : { targetCheckpoint }),
    ...(localCheckpoint === undefined ? {} : { localCheckpoint }),
  };
}

function checkpointFailure(
  checkpoint: string,
  local: boolean,
): CaughtUpBarrierFailure | null {
  if (CANONICAL_CHECKPOINT.test(checkpoint)) return null;
  return barrierFailure(
    local ? 'CAUGHT_UP_INVALID_LOCAL_CHECKPOINT' : 'CAUGHT_UP_INVALID_TARGET',
    `${local ? 'local' : 'target'} checkpoint must be a canonical unsigned decimal string`,
    local ? undefined : checkpoint,
    local ? checkpoint : undefined,
  );
}

export function checkpointReached(
  local: string,
  target: string,
): CaughtUpOutcome<boolean> {
  const localError = checkpointFailure(local, true);
  if (localError) return failure(localError);
  const targetError = checkpointFailure(target, false);
  if (targetError) return failure(targetError);
  return success(BigInt(local) >= BigInt(target));
}

export function validateAuthoritativeCheckpointTarget(
  target: AuthoritativeCheckpointTarget,
  expectedGeneration?: string,
): CaughtUpBarrierFailure | null {
  if (target.protocolVersion !== 1) {
    return barrierFailure(
      'CAUGHT_UP_INVALID_TARGET',
      'authoritative checkpoint target has unsupported protocolVersion',
      target.checkpoint,
    );
  }
  const checkpointError = checkpointFailure(target.checkpoint, false);
  if (checkpointError) return checkpointError;
  if (target.generation !== undefined && target.generation.length === 0) {
    return barrierFailure(
      'CAUGHT_UP_INVALID_TARGET',
      'authoritative checkpoint generation must be non-empty when present',
      target.checkpoint,
    );
  }
  if (
    expectedGeneration !== undefined &&
    target.generation !== expectedGeneration
  ) {
    return barrierFailure(
      'CAUGHT_UP_INVALIDATED',
      `checkpoint generation ${JSON.stringify(target.generation ?? null)} does not match expected generation ${JSON.stringify(expectedGeneration)}`,
      target.checkpoint,
    );
  }
  return null;
}

function normalizedNonNegative(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

type WaitResult<T> =
  | { kind: 'value'; value: T }
  | { kind: 'operation-error'; cause: unknown }
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

function waitForCaller<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<WaitResult<T>> {
  const operationResult = operation.then<WaitResult<T>>(
    (value) => ({ kind: 'value', value }),
    (cause: unknown) => ({ kind: 'operation-error', cause }),
  );
  const timeoutResult = new Promise<WaitResult<T>>((resolve) => {
    setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  if (!signal) return Promise.race([operationResult, timeoutResult]);
  if (signal.aborted) return Promise.resolve({ kind: 'cancelled' });
  const cancellationResult = new Promise<WaitResult<T>>((resolve) => {
    signal.addEventListener(
      'abort',
      () => resolve({ kind: 'cancelled' }),
      { once: true },
    );
  });
  return Promise.race([operationResult, timeoutResult, cancellationResult]);
}

function terminalWaitOutcome<T>(
  result: WaitResult<T>,
  target: string,
  local: string,
  syncFailureMessage: string,
): CaughtUpOutcome<T> | null {
  if (result.kind === 'value') return success(result.value);
  if (result.kind === 'operation-error') {
    return failure({
      kind: 'sync',
      message: syncFailureMessage,
      cause: result.cause,
      targetCheckpoint: target,
      localCheckpoint: local,
    });
  }
  if (result.kind === 'cancelled') {
    return failure(
      barrierFailure(
        'CAUGHT_UP_CANCELLED',
        'caught-up wait was cancelled',
        target,
        local,
      ),
    );
  }
  return failure(
    barrierFailure(
      'CAUGHT_UP_TIMEOUT',
      'caught-up wait timed out before the durable checkpoint reached the target',
      target,
      local,
    ),
  );
}

/**
 * Drive the ordinary single-flight sync loop until its *durable* checkpoint is
 * at or beyond `target.checkpoint`.
 */
export async function awaitCaughtUp(
  loop: CaughtUpSyncLoop,
  queue: Pick<ProtocolQueueAdapter, 'pullCheckpoint'>,
  target: AuthoritativeCheckpointTarget,
  options: AwaitCaughtUpOptions = {},
): Promise<CaughtUpOutcome> {
  const targetError = validateAuthoritativeCheckpointTarget(
    target,
    options.expectedGeneration,
  );
  if (targetError) return failure(targetError);
  const now = options.now ?? systemCaughtUpNow;
  const timeoutMs = normalizedNonNegative(options.timeoutMs, 30_000);
  const pollIntervalMs = normalizedNonNegative(options.pollIntervalMs, 50);
  const isOnline =
    options.isOnline ??
    (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let checkpoint = await queue.pullCheckpoint();
  const initialCheckpointError = checkpointFailure(checkpoint, true);
  if (initialCheckpointError) return failure(initialCheckpointError);
  const initialReached = checkpointReached(checkpoint, target.checkpoint);
  if (!initialReached.ok) return initialReached;
  if (initialReached.value) {
    return success({
      targetCheckpoint: target.checkpoint,
      checkpoint,
      generation: target.generation,
      elapsedMs: Math.max(0, now() - startedAt),
      cycles: 0,
      alreadyCaughtUp: true,
    });
  }

  let cycles = 0;
  for (;;) {
    if (options.signal?.aborted) {
      return failure(
        barrierFailure(
          'CAUGHT_UP_CANCELLED',
          'caught-up wait was cancelled',
          target.checkpoint,
          checkpoint,
        ),
      );
    }
    if (!isOnline() || loop.state?.status === 'offline') {
      return failure(
        barrierFailure(
          'CAUGHT_UP_OFFLINE',
          'cannot establish authoritative freshness while offline',
          target.checkpoint,
          checkpoint,
        ),
      );
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      return failure(
        barrierFailure(
          'CAUGHT_UP_TIMEOUT',
          'caught-up wait timed out before the durable checkpoint reached the target',
          target.checkpoint,
          checkpoint,
        ),
      );
    }

    const before = checkpoint;
    const waited = await waitForCaller(
      loop.syncNow(),
      options.signal,
      remaining,
    );
    const waitOutcome = terminalWaitOutcome(
      waited,
      target.checkpoint,
      checkpoint,
      'protocol sync failed before the caught-up target was reached',
    );
    if (!waitOutcome?.ok) return waitOutcome ?? failure(barrierFailure('CAUGHT_UP_TIMEOUT', 'caught-up wait did not complete', target.checkpoint, checkpoint));
    cycles += 1;

    checkpoint = await queue.pullCheckpoint();
    const checkpointError = checkpointFailure(checkpoint, true);
    if (checkpointError) return failure(checkpointError);
    const reached = checkpointReached(checkpoint, target.checkpoint);
    if (!reached.ok) return reached;
    if (reached.value) {
      return success({
        targetCheckpoint: target.checkpoint,
        checkpoint,
        generation: target.generation,
        elapsedMs: Math.max(0, now() - startedAt),
        cycles,
        alreadyCaughtUp: false,
      });
    }

    if (checkpoint === before && pollIntervalMs > 0) {
      const afterCycleRemaining = deadline - now();
      if (afterCycleRemaining <= 0) {
        return failure(
          barrierFailure(
            'CAUGHT_UP_TIMEOUT',
            'caught-up wait timed out before the durable checkpoint reached the target',
            target.checkpoint,
            checkpoint,
          ),
        );
      }
      const delayed = await waitForCaller(
        new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(pollIntervalMs, afterCycleRemaining)),
        ),
        options.signal,
        afterCycleRemaining,
      );
      const delayOutcome = terminalWaitOutcome(
        delayed,
        target.checkpoint,
        checkpoint,
        'caught-up poll delay failed',
      );
      if (!delayOutcome?.ok) {
        return delayOutcome ?? failure(barrierFailure('CAUGHT_UP_TIMEOUT', 'caught-up wait did not complete', target.checkpoint, checkpoint));
      }
    }
  }
}

/** Ask the server for a source-now checkpoint, then prove local durability. */
export async function requestAndAwaitCaughtUp(
  loop: CaughtUpSyncLoop,
  queue: Pick<ProtocolQueueAdapter, 'pullCheckpoint'>,
  requester: AuthoritativeCheckpointRequester,
  options: AwaitCaughtUpOptions = {},
): Promise<CaughtUpOutcome> {
  const now = options.now ?? systemCaughtUpNow;
  const timeoutMs = normalizedNonNegative(options.timeoutMs, 30_000);
  const startedAt = now();
  const requestController = new AbortController();
  const forwardAbort = () => requestController.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const requested = await waitForCaller(
    requester.requestCheckpoint(requestController.signal),
    options.signal,
    timeoutMs,
  );
  options.signal?.removeEventListener('abort', forwardAbort);
  if (requested.kind === 'operation-error') {
    return failure({
      kind: 'request',
      message: 'authoritative checkpoint request failed',
      cause: requested.cause,
    });
  }
  if (requested.kind === 'cancelled') {
    requestController.abort();
    return failure(
      barrierFailure('CAUGHT_UP_CANCELLED', 'caught-up wait was cancelled'),
    );
  }
  if (requested.kind === 'timeout') {
    requestController.abort();
    return failure(
      barrierFailure(
        'CAUGHT_UP_TIMEOUT',
        'caught-up wait timed out while requesting the authoritative checkpoint',
      ),
    );
  }
  const elapsed = Math.max(0, now() - startedAt);
  return awaitCaughtUp(loop, queue, requested.value, {
    ...options,
    timeoutMs: Math.max(0, timeoutMs - elapsed),
    now,
  });
}
