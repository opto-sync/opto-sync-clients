#![forbid(unsafe_code)]
#![allow(clippy::needless_return)]

use opto_sync_desktop_lifecycle::{
    requires_generation, BaseSyncLifecycleSnapshot, SyncLifecycleCommand, SyncLifecycleEvent,
    SyncLifecycleMachine, SyncLifecyclePhase, SyncLifecycleSnapshot, SyncLifecycleTransition,
    TransitionDisposition,
};

const PHASES: [SyncLifecyclePhase; 5] = [
    SyncLifecyclePhase::Idle,
    SyncLifecyclePhase::Acquiring,
    SyncLifecyclePhase::Running,
    SyncLifecyclePhase::Releasing,
    SyncLifecyclePhase::Closed,
];
const EVENTS: [SyncLifecycleEvent; 10] = [
    SyncLifecycleEvent::Wake,
    SyncLifecycleEvent::Join,
    SyncLifecycleEvent::BeginAcquire,
    SyncLifecycleEvent::AcquireGranted,
    SyncLifecycleEvent::AcquireDeferred,
    SyncLifecycleEvent::Cancel,
    SyncLifecycleEvent::CycleSettled,
    SyncLifecycleEvent::ReleaseSettled,
    SyncLifecycleEvent::Close,
    SyncLifecycleEvent::ProcessAbort,
];

fn apply(
    state: SyncLifecycleSnapshot,
    event: SyncLifecycleEvent,
    generation: Option<u64>,
) -> SyncLifecycleTransition {
    return SyncLifecycleMachine::reduce(state, SyncLifecycleCommand { event, generation });
}

fn applied(
    state: SyncLifecycleSnapshot,
    event: SyncLifecycleEvent,
    generation: Option<u64>,
) -> SyncLifecycleSnapshot {
    let transition = apply(state, event, generation);
    assert_eq!(transition.disposition, TransitionDisposition::Applied);
    return transition.after;
}

#[test]
fn happy_path_is_generation_fenced_and_close_is_terminal() {
    let start = SyncLifecycleSnapshot::INITIAL;
    let awake = applied(start, SyncLifecycleEvent::Wake, None);
    let acquiring = applied(awake, SyncLifecycleEvent::BeginAcquire, None);
    assert_eq!(acquiring.generation, 1);
    let running = applied(
        acquiring,
        SyncLifecycleEvent::AcquireGranted,
        Some(acquiring.generation),
    );
    assert!(running.may_run_sync_work());
    let releasing = applied(
        running,
        SyncLifecycleEvent::CycleSettled,
        Some(running.generation),
    );
    let idle = applied(
        releasing,
        SyncLifecycleEvent::ReleaseSettled,
        Some(releasing.generation),
    );
    let closed = applied(idle, SyncLifecycleEvent::Close, None);
    assert_eq!(closed.lifecycle.phase, SyncLifecyclePhase::Closed);
}

#[test]
fn stale_completion_stutters_without_touching_shared_state() {
    let awake = applied(
        SyncLifecycleSnapshot::INITIAL,
        SyncLifecycleEvent::Wake,
        None,
    );
    let acquiring = applied(awake, SyncLifecycleEvent::BeginAcquire, None);
    let stale = apply(
        acquiring,
        SyncLifecycleEvent::AcquireGranted,
        Some(acquiring.generation - 1),
    );
    assert_eq!(stale.disposition, TransitionDisposition::Stale);
    assert_eq!(stale.before, acquiring);
    assert_eq!(stale.after, acquiring);
}

#[test]
fn trailing_wake_preserves_generation_and_shared_transition_rules() {
    let awake = applied(
        SyncLifecycleSnapshot::INITIAL,
        SyncLifecycleEvent::Wake,
        None,
    );
    let acquiring = applied(awake, SyncLifecycleEvent::BeginAcquire, None);
    let running = applied(
        acquiring,
        SyncLifecycleEvent::AcquireGranted,
        Some(acquiring.generation),
    );
    let trailing = applied(running, SyncLifecycleEvent::Wake, None);
    assert!(trailing.lifecycle.wake_pending);
    let releasing = applied(
        trailing,
        SyncLifecycleEvent::CycleSettled,
        Some(trailing.generation),
    );
    let idle = applied(
        releasing,
        SyncLifecycleEvent::ReleaseSettled,
        Some(releasing.generation),
    );
    let next = applied(idle, SyncLifecycleEvent::BeginAcquire, None);
    assert_eq!(next.generation, trailing.generation + 1);
}

fn assert_command_space(state: SyncLifecycleSnapshot) {
    for event in EVENTS {
        for generation in [None, Some(state.generation), Some(state.generation + 1)] {
            let decision = apply(state, event, generation);
            assert_eq!(decision.before, state);
            match decision.disposition {
                TransitionDisposition::Applied => assert!(decision.after.is_valid()),
                TransitionDisposition::Rejected => assert_eq!(decision.after, state),
                TransitionDisposition::Stale => {
                    assert!(requires_generation(event));
                    assert_eq!(decision.after, state);
                }
            }
        }
    }
}

#[test]
fn reducer_is_total_over_4_800_finite_inputs() {
    assert_eq!(PHASES.len() * 16 * 2 * EVENTS.len() * 3, 4_800);
    for phase in PHASES {
        for wake_pending in [false, true] {
            for close_requested in [false, true] {
                for cancel_requested in [false, true] {
                    for permit_held in [false, true] {
                        for generation in [0_u64, 1_u64] {
                            assert_command_space(SyncLifecycleSnapshot {
                                lifecycle: BaseSyncLifecycleSnapshot {
                                    phase,
                                    wake_pending,
                                    close_requested,
                                    cancel_requested,
                                    permit_held,
                                },
                                generation,
                            });
                        }
                    }
                }
            }
        }
    }
}
