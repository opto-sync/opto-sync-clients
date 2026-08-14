/** Formally modeled mobile/desktop ownership lifecycle. */
export type SyncLifecyclePhase =
  | 'idle'
  | 'acquiring'
  | 'running'
  | 'releasing'
  | 'closed';

export type SyncLifecycleEvent =
  | 'wake'
  | 'join'
  | 'begin-acquire'
  | 'acquire-granted'
  | 'acquire-deferred'
  | 'cancel'
  | 'cycle-settled'
  | 'release-settled'
  | 'close'
  | 'process-abort';

export interface SyncLifecycleSnapshot {
  readonly phase: SyncLifecyclePhase;
  readonly wakePending: boolean;
  readonly closeRequested: boolean;
  readonly cancelRequested: boolean;
  readonly permitHeld: boolean;
}

export const initialSyncLifecycle: SyncLifecycleSnapshot = Object.freeze({
  phase: 'idle',
  wakePending: false,
  closeRequested: false,
  cancelRequested: false,
  permitHeld: false,
});

export function isValidSyncLifecycle(state: SyncLifecycleSnapshot): boolean {
  const activePermit = state.phase === 'running' || state.phase === 'releasing';
  if (state.permitHeld !== activePermit) return false;
  if (state.phase === 'closed') {
    return (
      state.closeRequested &&
      !state.wakePending &&
      !state.cancelRequested &&
      !state.permitHeld
    );
  }
  if (state.closeRequested && state.wakePending) return false;
  return !state.cancelRequested || state.phase === 'running';
}

function snapshot(
  state: SyncLifecycleSnapshot,
  changes: Partial<SyncLifecycleSnapshot>,
): SyncLifecycleSnapshot {
  return Object.freeze({ ...state, ...changes });
}

/** Pure transition relation mirrored by `formal/mobile_desktop_lifecycle.qnt`. */
export function transitionSyncLifecycle(
  state: SyncLifecycleSnapshot,
  event: SyncLifecycleEvent,
): SyncLifecycleSnapshot | undefined {
  if (!isValidSyncLifecycle(state)) return undefined;
  let next: SyncLifecycleSnapshot | undefined;
  switch (event) {
    case 'wake':
      if (state.phase === 'closed' || state.closeRequested) return undefined;
      next = snapshot(state, { wakePending: true });
      break;
    case 'join':
      if (
        state.phase !== 'acquiring' &&
        state.phase !== 'running' &&
        state.phase !== 'releasing'
      ) {
        return undefined;
      }
      next = state;
      break;
    case 'begin-acquire':
      if (
        state.phase !== 'idle' ||
        !state.wakePending ||
        state.closeRequested
      ) {
        return undefined;
      }
      next = snapshot(state, { phase: 'acquiring', wakePending: false });
      break;
    case 'acquire-granted':
      if (state.phase !== 'acquiring') return undefined;
      next = snapshot(state, {
        phase: state.closeRequested ? 'releasing' : 'running',
        permitHeld: true,
        cancelRequested: false,
      });
      break;
    case 'acquire-deferred':
      if (state.phase !== 'acquiring') return undefined;
      next = snapshot(state, {
        phase: state.closeRequested ? 'closed' : 'idle',
        wakePending: state.closeRequested ? false : state.wakePending,
        cancelRequested: false,
        permitHeld: false,
      });
      break;
    case 'cancel':
      if (state.phase !== 'running') return undefined;
      next = snapshot(state, { cancelRequested: true });
      break;
    case 'cycle-settled':
      if (state.phase !== 'running' || !state.permitHeld) return undefined;
      next = snapshot(state, {
        phase: 'releasing',
        cancelRequested: false,
      });
      break;
    case 'release-settled':
      if (state.phase !== 'releasing' || !state.permitHeld) return undefined;
      next = snapshot(state, {
        phase: state.closeRequested ? 'closed' : 'idle',
        wakePending: state.closeRequested ? false : state.wakePending,
        cancelRequested: false,
        permitHeld: false,
      });
      break;
    case 'close':
      if (state.phase === 'closed') return undefined;
      if (state.phase === 'idle') {
        next = snapshot(state, {
          phase: 'closed',
          wakePending: false,
          closeRequested: true,
          cancelRequested: false,
        });
      } else {
        next = snapshot(state, {
          wakePending: false,
          closeRequested: true,
          cancelRequested: state.phase === 'running',
        });
      }
      break;
    case 'process-abort':
      if (
        state.phase !== 'acquiring' &&
        state.phase !== 'running' &&
        state.phase !== 'releasing'
      ) {
        return undefined;
      }
      next = snapshot(state, {
        phase: state.closeRequested ? 'closed' : 'idle',
        wakePending: false,
        cancelRequested: false,
        permitHeld: false,
      });
      break;
  }
  return next && isValidSyncLifecycle(next) ? next : undefined;
}

export class SyncLifecycleTransitionError extends Error {
  readonly before: SyncLifecycleSnapshot;
  readonly event: SyncLifecycleEvent;

  constructor(
    before: SyncLifecycleSnapshot,
    event: SyncLifecycleEvent,
  ) {
    super(
      `undefined opto-sync lifecycle transition: ${before.phase} + ${event}`,
    );
    this.name = 'SyncLifecycleTransitionError';
    this.before = before;
    this.event = event;
  }
}

/** Production state machine; undefined events fail closed without mutation. */
export class SyncLifecycleMachine {
  #state = initialSyncLifecycle;

  get state(): SyncLifecycleSnapshot {
    return this.#state;
  }

  apply(event: SyncLifecycleEvent): SyncLifecycleSnapshot {
    const next = transitionSyncLifecycle(this.#state, event);
    if (!next) throw new SyncLifecycleTransitionError(this.#state, event);
    this.#state = next;
    return next;
  }
}
