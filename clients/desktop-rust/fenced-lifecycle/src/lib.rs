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

        let Some(next_lifecycle) =
            BaseSyncLifecycleMachine::transition(state.lifecycle, command.event)
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
