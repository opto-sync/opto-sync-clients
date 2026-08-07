import {
  BehaviorSubject,
  Observable,
  distinctUntilChanged,
} from 'rxjs';

export interface SyncLoopLike {
  start(): void;
  stop(): void;
  hint(): void;
}

export interface CrossContextCoordinatorOptions {
  /**
   * Non-secret, session-scoped name (normally the value returned by
   * `sessionDatabaseName`). Tabs for different signed-in sessions must not use
   * the same namespace.
   */
  namespace: string;
  loop: SyncLoopLike;
  channelName?: string;
  lockName?: string;
  BroadcastChannel?: typeof globalThis.BroadcastChannel;
  locks?: LockManager;
  /**
   * Optional durable wake fallback, normally `requestServiceWorkerSync`.
   * Called after every hint, including when BroadcastChannel/Web Locks are
   * unavailable.
   */
  requestBackgroundSync?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export interface CrossContextState {
  status: 'stopped' | 'candidate' | 'leader' | 'cooperative';
  leader: boolean;
  coordinated: boolean;
}

interface HintMessage {
  type: 'opto-sync:hint';
  namespace: string;
}

function isHintMessage(value: unknown, namespace: string): value is HintMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'opto-sync:hint' &&
    (value as { namespace?: unknown }).namespace === namespace
  );
}

/**
 * Coordinates tabs, windows, workers, and sessions over Web Locks plus
 * BroadcastChannel.
 *
 * With Web Locks, exactly one context owns the foreground network loop.
 * Followers publish wake hints while every context continues reading the same
 * session-scoped IndexedDB. Without Web Locks, each context may sync; protocol
 * idempotency and exact-batch acknowledgements preserve correctness.
 */
export class CrossContextSyncCoordinator {
  private readonly stateSubject = new BehaviorSubject<CrossContextState>({
    status: 'stopped',
    leader: false,
    coordinated: false,
  });
  private channel?: BroadcastChannel;
  private abort?: AbortController;
  private releaseLeader?: () => void;
  private lockTask?: Promise<void>;
  private started = false;

  readonly state$: Observable<CrossContextState> = this.stateSubject
    .asObservable()
    .pipe(
      distinctUntilChanged(
        (left, right) =>
          left.status === right.status &&
          left.leader === right.leader &&
          left.coordinated === right.coordinated,
      ),
    );

  constructor(private readonly options: CrossContextCoordinatorOptions) {
    if (!options.namespace) throw new TypeError('namespace is required');
  }

  get state(): Readonly<CrossContextState> {
    return this.stateSubject.value;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const BroadcastChannelImpl =
      this.options.BroadcastChannel ?? globalThis.BroadcastChannel;
    if (typeof BroadcastChannelImpl === 'function') {
      this.channel = new BroadcastChannelImpl(
        this.options.channelName ?? `opto-sync:${this.options.namespace}`,
      );
      this.channel.addEventListener('message', this.onMessage);
    }

    const locks = this.options.locks ?? globalThis.navigator?.locks;
    if (!locks) {
      // Compatibility mode: duplicate network work is safe because the queue
      // and protocol are idempotent. This is preferable to a stuck offline
      // queue in browsers without Web Locks.
      this.options.loop.start();
      this.transition({
        status: 'cooperative',
        leader: true,
        coordinated: false,
      });
      return;
    }

    const abort = new AbortController();
    this.abort = abort;
    this.transition({
      status: 'candidate',
      leader: false,
      coordinated: true,
    });
    this.lockTask = locks
      .request(
        this.options.lockName ?? `opto-sync:leader:${this.options.namespace}`,
        { mode: 'exclusive', signal: abort.signal },
        async () => {
          if (!this.started || abort.signal.aborted) return;
          this.transition({
            status: 'leader',
            leader: true,
            coordinated: true,
          });
          this.options.loop.start();
          await new Promise<void>((resolve) => {
            this.releaseLeader = resolve;
          });
          this.releaseLeader = undefined;
          this.options.loop.stop();
        },
      )
      .then(() => undefined)
      .catch((error) => {
        if (!abort.signal.aborted) this.options.onError?.(error);
      });
  }

  /**
   * Wake the current leader and the service-worker/OS fallback.
   *
   * Messages never include payloads, tokens, tenant ids, or record ids.
   */
  hint(): void {
    if (!this.started) return;
    if (this.state.leader) this.options.loop.hint();
    this.channel?.postMessage({
      type: 'opto-sync:hint',
      namespace: this.options.namespace,
    } satisfies HintMessage);
    try {
      const requested = this.options.requestBackgroundSync?.();
      if (requested) {
        void Promise.resolve(requested).catch((error) =>
          this.options.onError?.(error),
        );
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.channel?.removeEventListener('message', this.onMessage);
    this.channel?.close();
    this.channel = undefined;
    this.releaseLeader?.();
    this.abort?.abort();
    this.abort = undefined;
    if (this.state.status === 'cooperative') this.options.loop.stop();
    await this.lockTask;
    this.lockTask = undefined;
    this.transition({
      status: 'stopped',
      leader: false,
      coordinated: false,
    });
  }

  private readonly onMessage = (event: MessageEvent<unknown>) => {
    if (this.state.leader && isHintMessage(event.data, this.options.namespace)) {
      this.options.loop.hint();
    }
  };

  private transition(state: CrossContextState): void {
    this.stateSubject.next(state);
  }
}
