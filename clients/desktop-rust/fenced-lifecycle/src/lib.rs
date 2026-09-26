#![forbid(unsafe_code)]
#![allow(clippy::needless_return)]

//! Generation-fenced adapter over the canonical `opto-sync-desktop` lifecycle.
//!
//! The underlying package remains the only owner of phase-transition rules.
//! This adapter adds portable generation identities so late asynchronous
//! settlements can be rejected as stale without copying the transition table.

pub use opto_sync_desktop::{
    SyncLifecycleEvent, SyncLifecycleMachine as BaseSyncLifecycleMachine, SyncLifecyclePhase,
    SyncLifecycleSnapshot as BaseSyncLifecycleSnapshot,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransitionDisposition {
    Applied,
    Rejected,
    Stale,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SyncLifecycleCommand {
    pub event: SyncLifecycleEvent,
    pub generation: Option<u64>,
}

impl SyncLifecycleCommand {
    #[must_use]
    pub const fn new(event: SyncLifecycleEvent) -> Self {
        return Self {
            event,
            generation: None,
        };
    }

    #[must_use]
    pub const fn generated(event: SyncLifecycleEvent, generation: u64) -> Self {
        return Self {
            event,
            generation: Some(generation),
        };
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SyncLifecycleSnapshot {
    pub lifecycle: BaseSyncLifecycleSnapshot,
    pub generation: u64,
}

impl SyncLifecycleSnapshot {
    pub const INITIAL: Self = Self {
        lifecycle: BaseSyncLifecycleSnapshot::INITIAL,
        generation: 0,
    };

    #[must_use]
    pub fn is_valid(self) -> bool {
        return self.lifecycle.is_valid();
    }

    #[must_use]
    pub fn may_run_sync_work(self) -> bool {
        return matches!(self.lifecycle.phase, SyncLifecyclePhase::Running)
            && self.lifecycle.permit_held
            && !self.lifecycle.cancel_requested
            && !self.lifecycle.close_requested;
    }

    #[must_use]
    pub fn accepts_wake(self) -> bool {
        return !matches!(self.lifecycle.phase, SyncLifecyclePhase::Closed)
            && !self.lifecycle.close_requested;
    }
}

impl Default for SyncLifecycleSnapshot {
    fn default() -> Self {
        return Self::INITIAL;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SyncLifecycleTransition {
    pub disposition: TransitionDisposition,
    pub before: SyncLifecycleSnapshot,
    pub after: SyncLifecycleSnapshot,
    pub command: SyncLifecycleCommand,
}

impl SyncLifecycleTransition {
    #[must_use]
    pub const fn applied(self) -> bool {
        return matches!(self.disposition, TransitionDisposition::Applied);
    }
}

#[derive(Debug, Default)]
pub struct SyncLifecycleMachine {
    state: SyncLifecycleSnapshot,
}

impl SyncLifecycleMachine {
    #[must_use]
    pub const fn state(&self) -> SyncLifecycleSnapshot {
        return self.state;
    }

    pub fn dispatch(&mut self, command: SyncLifecycleCommand) -> SyncLifecycleTransition {
        let decision = Self::reduce(self.state, command);

        if decision.applied() {
            self.state = decision.after;
        }

        return decision;
    }

    #[must_use]
    pub fn reduce(
        state: SyncLifecycleSnapshot,
        command: SyncLifecycleCommand,
    ) -> SyncLifecycleTransition {
        let unchanged = |disposition| SyncLifecycleTransition {
            disposition,
            before: state,
            after: state,
            command,
        };

        if !state.is_valid() {
            return unchanged(TransitionDisposition::Rejected);
        }

        if requires_generation(command.event) {
            let Some(generation) = command.generation else {
                return unchanged(TransitionDisposition::Rejected);
            };

            if generation != state.generation {
                return unchanged(TransitionDisposition::Stale);
            }
        }

        let Some(next_lifecycle) = BaseSyncLifecycleMachine::transition(state.lifecycle, command.event)
        else {
            return unchanged(TransitionDisposition::Rejected);
        };

        let generation = if matches!(command.event, SyncLifecycleEvent::BeginAcquire) {
            let Some(next_generation) = state.generation.checked_add(1) else {
                return unchanged(TransitionDisposition::Rejected);
            };
            next_generation
        } else {
            state.generation
        };

        let after = SyncLifecycleSnapshot {
            lifecycle: next_lifecycle,
            generation,
        };

        if !after.is_valid() {
            return unchanged(TransitionDisposition::Rejected);
        }

        return SyncLifecycleTransition {
            disposition: TransitionDisposition::Applied,
            before: state,
            after,
            command,
        };
    }
}

#[must_use]
pub const fn requires_generation(event: SyncLifecycleEvent) -> bool {
    return matches!(
        event,
        SyncLifecycleEvent::AcquireGranted
            | SyncLifecycleEvent::AcquireDeferred
            | SyncLifecycleEvent::CycleSettled
            | SyncLifecycleEvent::ReleaseSettled
            | SyncLifecycleEvent::ProcessAbort
    );
}

#[cfg(test)]
mod tests {
    use super::*;

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
        machine: &mut SyncLifecycleMachine,
        event: SyncLifecycleEvent,
        generation: Option<u64>,
    ) -> SyncLifecycleTransition {
        return machine.dispatch(SyncLifecycleCommand { event, generation });
    }

    #[test]
    fn happy_path_is_generation_fenced_and_close_is_terminal() {
        let mut machine = SyncLifecycleMachine::default();
        assert!(apply(&mut machine, SyncLifecycleEvent::Wake, None).applied());
        let begin = apply(&mut machine, SyncLifecycleEvent::BeginAcquire, None);
        let generation = begin.after.generation;
        assert_eq!(generation, 1);
        assert!(
            apply(
                &mut machine,
                SyncLifecycleEvent::AcquireGranted,
                Some(generation)
            )
            .applied()
        );
        assert!(machine.state().may_run_sync_work());
        assert!(
            apply(
                &mut machine,
                SyncLifecycleEvent::CycleSettled,
                Some(generation)
            )
            .applied()
        );
        assert!(
            apply(
                &mut machine,
                SyncLifecycleEvent::ReleaseSettled,
                Some(generation)
            )
            .applied()
        );
        assert!(apply(&mut machine, SyncLifecycleEvent::Close, None).applied());
        assert_eq!(machine.state().lifecycle.phase, SyncLifecyclePhase::Closed);
    }

    #[test]
    fn stale_completion_stutters_without_touching_shared_state() {
        let mut machine = SyncLifecycleMachine::default();
        apply(&mut machine, SyncLifecycleEvent::Wake, None);
        let begin = apply(&mut machine, SyncLifecycleEvent::BeginAcquire, None);
        let before = machine.state();
        let stale = apply(
            &mut machine,
            SyncLifecycleEvent::AcquireGranted,
            Some(begin.after.generation - 1),
        );

        assert_eq!(stale.disposition, TransitionDisposition::Stale);
        assert_eq!(stale.before, before);
        assert_eq!(stale.after, before);
        assert_eq!(machine.state(), before);
    }

    #[test]
    fn trailing_wake_preserves_generation_and_shared_transition_rules() {
        let mut machine = SyncLifecycleMachine::default();
        apply(&mut machine, SyncLifecycleEvent::Wake, None);
        let begin = apply(&mut machine, SyncLifecycleEvent::BeginAcquire, None);
        let generation = begin.after.generation;
        apply(
            &mut machine,
            SyncLifecycleEvent::AcquireGranted,
            Some(generation),
        );
        apply(&mut machine, SyncLifecycleEvent::Wake, None);
        assert!(machine.state().lifecycle.wake_pending);
        assert_eq!(machine.state().generation, generation);
        apply(
            &mut machine,
            SyncLifecycleEvent::CycleSettled,
            Some(generation),
        );
        apply(
            &mut machine,
            SyncLifecycleEvent::ReleaseSettled,
            Some(generation),
        );
        let next = apply(&mut machine, SyncLifecycleEvent::BeginAcquire, None);
        assert_eq!(next.after.generation, generation + 1);
    }

    #[test]
    fn reducer_is_total_over_finite_input_space() {
        let mut examined = 0_u32;

        for phase in PHASES {
            for wake_pending in [false, true] {
                for close_requested in [false, true] {
                    for cancel_requested in [false, true] {
                        for permit_held in [false, true] {
                            for generation in [0_u64, 1_u64] {
                                let state = SyncLifecycleSnapshot {
                                    lifecycle: BaseSyncLifecycleSnapshot {
                                        phase,
                                        wake_pending,
                                        close_requested,
                                        cancel_requested,
                                        permit_held,
                                    },
                                    generation,
                                };

                                for event in EVENTS {
                                    for command_generation in
                                        [None, Some(generation), Some(generation + 1)]
                                    {
                                        let decision = SyncLifecycleMachine::reduce(
                                            state,
                                            SyncLifecycleCommand {
                                                event,
                                                generation: command_generation,
                                            },
                                        );
                                        examined += 1;
                                        assert_eq!(decision.before, state);

                                        match decision.disposition {
                                            TransitionDisposition::Applied => {
                                                assert!(state.is_valid());
                                                assert!(decision.after.is_valid());
                                            }
                                            TransitionDisposition::Rejected => {
                                                assert_eq!(decision.after, state);
                                            }
                                            TransitionDisposition::Stale => {
                                                assert!(requires_generation(event));
                                                assert_eq!(decision.after, state);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        assert_eq!(examined, 4_800);
    }
}
