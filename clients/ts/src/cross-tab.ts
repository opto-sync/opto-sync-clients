/**
 * Cross-tab / cross-window coordination.
 *
 * Every tab shares one IndexedDB queue (same origin, same database name), and
 * the queue is already safe under concurrency: mutation ids are allocated in
 * one transaction and pushes dedupe on (clientId, mutationId). What SHOULD be
 * exclusive is the sync loop itself — N tabs each running push/pull wastes
 * battery and server capacity for zero correctness gain.
 *
 * `startCrossTabCoordinator` elects exactly one leader with the Web Locks API
 * (`navigator.locks.request` with an infinitely-held lock: the browser hands
 * the lock to the next waiter the moment the leader tab dies, crashes, or
 * closes — no heartbeats, no split-brain). The leader runs the loop; every
 * tab can broadcast a `hint` over BroadcastChannel and the leader picks it
 * up. Sync state is re-broadcast so follower tabs can render status.
 *
 * Environments without Web Locks (very old browsers, some webviews) degrade
 * to every-tab-leads, which is exactly today's baseline behavior.
 */
import type { ProtocolSyncLoop, ProtocolSyncState } from './sync-loop.js';

export const DEFAULT_CHANNEL = 'opto-sync';
export const DEFAULT_LEADER_LOCK = 'opto-sync-leader';

interface BroadcastChannelLike {
  postMessage(value: unknown): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
}

interface LockManagerLike {
  request(
    name: string,
    options: { mode?: 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
}

export interface CrossTabCoordinatorOptions {
  /** The loop to run while (and only while) this tab is the leader. */
  loop: Pick<ProtocolSyncLoop, 'start' | 'stop' | 'hint'>;
  channelName?: string;
  lockName?: string;
  /** Called when leadership is acquired or lost. */
  onLeadershipChange?: (isLeader: boolean) => void;
  /** Receives sync state broadcast by the current leader (any tab). */
  onRemoteState?: (state: ProtocolSyncState) => void;
  /** Injectable platform hooks for tests. */
  broadcastChannelFactory?: (name: string) => BroadcastChannelLike;
  locks?: LockManagerLike;
}

export interface CrossTabCoordinator {
  /** True while this tab holds the leader lock. */
  readonly isLeader: boolean;
  /**
   * Wake the sync loop wherever it runs: locally when leading, otherwise via
   * broadcast to the leader. Use as `onMutationQueued` target in multi-tab
   * apps that do not use the service worker path.
   */
  hint(): void;
  /** Leader-side helper: publish sync state to follower tabs. */
  publishState(state: ProtocolSyncState): void;
  /** Resign leadership (if held), close the channel, stop the loop. */
  dispose(): void;
}

function defaultLocks(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
  return nav?.locks as LockManagerLike | undefined;
}

function defaultChannelFactory(name: string): BroadcastChannelLike | undefined {
  const Ctor = (globalThis as Record<string, unknown>).BroadcastChannel as
    | (new (name: string) => BroadcastChannelLike)
    | undefined;
  return Ctor ? new Ctor(name) : undefined;
}

export function startCrossTabCoordinator(
  options: CrossTabCoordinatorOptions,
): CrossTabCoordinator {
  const channel =
    options.broadcastChannelFactory?.(options.channelName ?? DEFAULT_CHANNEL) ??
    defaultChannelFactory(options.channelName ?? DEFAULT_CHANNEL);
  const locks = options.locks ?? defaultLocks();

  let leader = false;
  let disposed = false;
  const abort = new AbortController();
  let releaseLock: (() => void) | undefined;

  const becomeLeader = () => {
    if (disposed) return;
    leader = true;
    options.loop.start();
    try {
      options.onLeadershipChange?.(true);
    } catch {
      // observers must not break coordination
    }
  };

  if (locks) {
    // Held forever; resolves only on dispose. The browser queues the other
    // tabs and promotes the next one automatically when this tab goes away.
    void locks
      .request(
        options.lockName ?? DEFAULT_LEADER_LOCK,
        { mode: 'exclusive', signal: abort.signal },
        () =>
          new Promise<void>((resolve) => {
            // `dispose()` races the grant: aborting a Web Lock request only
            // cancels it while it is still QUEUED, so a request the browser
            // had already decided to grant still runs this callback after
            // disposal. Resolving immediately hands the lock straight back.
            // Holding it instead would strand the lease forever — no other
            // tab could ever be promoted, and the queue would stop draining
            // origin-wide until every tab was closed.
            if (disposed) {
              resolve();
              return;
            }
            releaseLock = resolve;
            becomeLeader();
          }),
      )
      .catch(() => {
        // AbortError from dispose before acquisition — nothing to do.
      });
  } else {
    becomeLeader(); // no Web Locks: behave like a single-tab app
  }

  const onMessage = (event: { data: unknown }) => {
    if (disposed) return;
    const data = event.data as { type?: string; state?: ProtocolSyncState } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hint' && leader) {
      options.loop.hint();
    } else if (data.type === 'state' && !leader && isSyncState(data.state)) {
      try {
        options.onRemoteState?.(data.state);
      } catch {
        // observers must not break coordination
      }
    }
  };
  channel?.addEventListener('message', onMessage);

  return {
    get isLeader() {
      return leader;
    },
    hint() {
      if (leader) {
        options.loop.hint();
      } else {
        channel?.postMessage({ type: 'hint' });
      }
    },
    publishState(state: ProtocolSyncState) {
      channel?.postMessage({ type: 'state', state });
    },
    dispose() {
      disposed = true;
      abort.abort();
      if (leader) {
        leader = false;
        options.loop.stop();
        try {
          options.onLeadershipChange?.(false);
        } catch {
          // observers must not break coordination
        }
      }
      releaseLock?.();
      channel?.removeEventListener?.('message', onMessage);
      channel?.close();
    },
  };
}
