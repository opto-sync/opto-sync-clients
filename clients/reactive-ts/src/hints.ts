import {
  Observable,
  Subject,
  auditTime,
  catchError,
  concatMap,
  from,
  map,
  merge,
  of,
  share,
} from 'rxjs';
import type { SchedulerLike } from 'rxjs';

import type { SyncHint } from './contracts.ts';

export interface SyncWakeResult<R = unknown> {
  ok: boolean;
  trigger: SyncHint;
  result?: R;
  error?: unknown;
}

export interface SyncWakePipelineOptions<R> {
  hints: readonly Observable<SyncHint>[];
  syncNow: () => Promise<R>;
  coalesceMs?: number;
  lockName?: string;
  scheduler?: SchedulerLike;
}

interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: unknown | null) => Promise<T | null>,
  ): Promise<T | null>;
}

/** Use Web Locks when available so tabs/windows do not upload one queue twice. */
export async function runWithBrowserSyncLock<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T | null> {
  const manager =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { locks?: LockManagerLike }).locks;
  if (!manager) return work();
  return manager.request(
    name,
    { ifAvailable: true, mode: 'exclusive' },
    async (lock) => (lock === null ? null : work()),
  );
}

/**
 * Coalesce noisy WebSocket/Supabase/BroadcastChannel hints and serialize cycles.
 *
 * `concatMap` is deliberate: hints arriving while a cycle runs become at most
 * one coalesced trailing cycle instead of being lost. This closes the race where
 * a mutation commits just after the active cycle inspected its durable queue.
 */
export function createSyncWakePipeline<R>(
  options: SyncWakePipelineOptions<R>,
): Observable<SyncWakeResult<R>> {
  if (options.hints.length === 0) {
    throw new Error('createSyncWakePipeline requires at least one hint stream');
  }
  const coalesceMs = options.coalesceMs ?? 25;
  if (!Number.isFinite(coalesceMs) || coalesceMs < 0) {
    throw new RangeError('coalesceMs must be a non-negative finite number');
  }
  const lockName = options.lockName ?? 'opto-sync:protocol-cycle';

  return merge(...options.hints).pipe(
    auditTime(coalesceMs, options.scheduler),
    concatMap((trigger) =>
      from(runWithBrowserSyncLock(lockName, options.syncNow)).pipe(
        map((result) => ({
          ok: true,
          trigger,
          ...(result === null ? {} : { result }),
        })),
        catchError((error) => of({ ok: false, trigger, error })),
      ),
    ),
    share(),
  );
}

export interface BroadcastChannelLike {
  postMessage(value: unknown): void;
  close(): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
}

export interface BroadcastHintBus {
  hints$: Observable<SyncHint>;
  publish(hint: SyncHint): void;
  close(): void;
}

const WAKE_REASONS = new Set<SyncHint['reason']>([
  'local-mutation',
  'remote-change',
  'connectivity',
  'background-wake',
  'manual',
]);

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

/** Strip unexpected structured-clone fields and make the bus the source. */
function sanitizeBroadcastHint(value: unknown): SyncHint | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SyncHint>;
  const reason = WAKE_REASONS.has(raw.reason as SyncHint['reason'])
    ? (raw.reason as SyncHint['reason'])
    : undefined;
  const sessionPartition = boundedString(raw.sessionPartition, 512);
  if (!reason || !sessionPartition) return null;
  return {
    reason,
    source: 'broadcast',
    sessionPartition,
    ...(boundedString(raw.table, 256)
      ? { table: boundedString(raw.table, 256) }
      : {}),
    ...(boundedString(raw.recordId, 512)
      ? { recordId: boundedString(raw.recordId, 512) }
      : {}),
    ...(boundedString(raw.checkpoint, 512)
      ? { checkpoint: boundedString(raw.checkpoint, 512) }
      : {}),
  };
}

/** Broadcast durable queue wakes across tabs/windows without broadcasting data. */
export function createBroadcastHintBus(
  name: string,
  factory: (name: string) => BroadcastChannelLike = (channelName) =>
    new BroadcastChannel(channelName) as unknown as BroadcastChannelLike,
): BroadcastHintBus {
  if (!name || name.length > 256) {
    throw new RangeError('BroadcastChannel name must be 1 through 256 characters');
  }
  const channel = factory(name);
  const subject = new Subject<SyncHint>();
  const listener = (event: { data: unknown }) => {
    const hint = sanitizeBroadcastHint(event.data);
    if (hint) subject.next(hint);
  };
  channel.addEventListener('message', listener);
  return {
    hints$: subject.asObservable(),
    publish(hint) {
      const sanitized = sanitizeBroadcastHint(hint);
      if (!sanitized) {
        throw new TypeError('invalid opto-sync BroadcastChannel hint');
      }
      channel.postMessage(sanitized);
      // BroadcastChannel never loops a message back to its sending object.
      subject.next(sanitized);
    },
    close() {
      channel.removeEventListener('message', listener);
      channel.close();
      subject.complete();
    },
  };
}
