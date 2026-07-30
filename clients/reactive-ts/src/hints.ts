import {
  Observable,
  Subject,
  auditTime,
  catchError,
  exhaustMap,
  from,
  map,
  merge,
  of,
  share,
} from 'rxjs';

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
  const manager = (
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { locks?: LockManagerLike }).locks
  );
  if (!manager) return work();
  return manager.request(
    name,
    { ifAvailable: true, mode: 'exclusive' },
    async (lock) => (lock === null ? null : work()),
  );
}

/**
 * Coalesce noisy WebSocket/Supabase/BroadcastChannel hints and serialize cycles.
 * `exhaustMap` intentionally ignores another wake while the current cycle owns
 * the queue; the loop itself observes remaining work before it returns.
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
    auditTime(coalesceMs),
    exhaustMap((trigger) =>
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
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
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

function isHint(value: unknown): value is SyncHint {
  if (!value || typeof value !== 'object') return false;
  const hint = value as Partial<SyncHint>;
  return (
    typeof hint.reason === 'string' &&
    typeof hint.source === 'string' &&
    typeof hint.sessionPartition === 'string'
  );
}

/** Broadcast durable queue wakes across tabs/windows without broadcasting data. */
export function createBroadcastHintBus(
  name: string,
  factory: (name: string) => BroadcastChannelLike = (channelName) =>
    new BroadcastChannel(channelName) as unknown as BroadcastChannelLike,
): BroadcastHintBus {
  const channel = factory(name);
  const subject = new Subject<SyncHint>();
  const listener = (event: { data: unknown }) => {
    if (isHint(event.data)) subject.next(event.data);
  };
  channel.addEventListener('message', listener);
  return {
    hints$: subject.asObservable(),
    publish(hint) {
      channel.postMessage(hint);
      // BroadcastChannel never loops a message back to its sending object.
      subject.next({ ...hint, source: 'broadcast' });
    },
    close() {
      channel.removeEventListener('message', listener);
      channel.close();
      subject.complete();
    },
  };
}
