//! Runtime-neutral authority for protocol sync-loop scheduling.
//!
//! The synchronous [`crate::protocol_sync::ProtocolSyncDriver`] owns one
//! correctness-sensitive cycle. This machine owns the host scheduler around
//! those cycles: timer generations, single flight, offline suppression,
//! trailing wake coalescing, retry phases, and stale callback rejection.

/// Observable scheduler phase shared with the TypeScript and Dart clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSchedulerPhase {
    Stopped,
    Idle,
    Syncing,
    Offline,
    Backoff,
    Error,
}

/// Ordered reset subphase within an active protocol cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSchedulerResetPhase {
    None,
    SnapshotRequested,
    SnapshotInstalled,
}

/// Complete state needed to schedule a protocol driver without hidden flags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolSchedulerState {
    pub phase: ProtocolSchedulerPhase,
    pub online: bool,
    pub generation: u64,
    pub timer_pending: bool,
    pub timer_generation: u64,
    pub stale_timer_pending: bool,
    pub cycle_pending: bool,
    pub cycle_generation: u64,
    pub network_active: bool,
    pub wake_pending: bool,
    pub consecutive_failures: u8,
    pub reset_phase: ProtocolSchedulerResetPhase,
    pub pages_seen: u8,
}

impl Default for ProtocolSchedulerState {
    fn default() -> Self {
        Self {
            phase: ProtocolSchedulerPhase::Stopped,
            online: true,
            generation: 0,
            timer_pending: false,
            timer_generation: 0,
            stale_timer_pending: false,
            cycle_pending: false,
            cycle_generation: 0,
            network_active: false,
            wake_pending: false,
            consecutive_failures: 0,
            reset_phase: ProtocolSchedulerResetPhase::None,
            pages_seen: 0,
        }
    }
}

/// Environment or application event accepted by [`ProtocolSyncScheduler`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSchedulerEvent {
    Start,
    Stop,
    Hint,
    GoOffline,
    GoOnline,
    TimerFire,
    TimerJoin,
    StaleTimerFire,
    PageMore,
    BeginReset,
    FinishReset,
    CycleSuccess,
    CycleSuccessMore,
    CycleRetryableFailure,
    CyclePermanentFailure,
    MalformedResponse,
    StaleCycleSuccess,
    StaleCycleFailure,
    Idle,
}

/// Invalid events are rejected without mutating scheduler state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolSchedulerTransitionError {
    pub event: ProtocolSchedulerEvent,
    pub phase: ProtocolSchedulerPhase,
}

impl std::fmt::Display for ProtocolSchedulerTransitionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "invalid protocol scheduler event {:?} while {:?}",
            self.event, self.phase
        )
    }
}

impl std::error::Error for ProtocolSchedulerTransitionError {}

/// Fail-closed scheduler around [`crate::protocol_sync::ProtocolSyncDriver`].
#[derive(Debug, Clone, Default)]
pub struct ProtocolSyncScheduler {
    state: ProtocolSchedulerState,
}

impl ProtocolSyncScheduler {
    pub const MAX_CONSECUTIVE_FAILURES: u8 = 31;
    pub const MAX_PAGES_PER_REFINEMENT_TRACE: u8 = 2;

    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub const fn state(&self) -> &ProtocolSchedulerState {
        &self.state
    }

    /// Apply one scheduler event atomically.
    ///
    /// # Errors
    ///
    /// Returns an error when the event is not enabled. The original state is
    /// retained byte-for-byte on rejection.
    pub fn apply(
        &mut self,
        event: ProtocolSchedulerEvent,
    ) -> Result<&ProtocolSchedulerState, ProtocolSchedulerTransitionError> {
        let mut next = self.state.clone();
        let enabled = match event {
            ProtocolSchedulerEvent::Idle => true,
            ProtocolSchedulerEvent::Start => {
                if next.phase != ProtocolSchedulerPhase::Stopped {
                    false
                } else if let Some(generation) = next.generation.checked_add(1) {
                    next.phase = if next.online {
                        ProtocolSchedulerPhase::Idle
                    } else {
                        ProtocolSchedulerPhase::Offline
                    };
                    next.generation = generation;
                    next.timer_pending = next.online;
                    next.timer_generation = generation;
                    next.wake_pending = false;
                    next.consecutive_failures = 0;
                    next.reset_phase = ProtocolSchedulerResetPhase::None;
                    next.pages_seen = 0;
                    true
                } else {
                    false
                }
            }
            ProtocolSchedulerEvent::Stop => {
                if next.phase == ProtocolSchedulerPhase::Stopped {
                    false
                } else if let Some(generation) = next.generation.checked_add(1) {
                    next.phase = ProtocolSchedulerPhase::Stopped;
                    next.generation = generation;
                    next.stale_timer_pending |= next.timer_pending;
                    next.timer_pending = false;
                    next.network_active = false;
                    next.wake_pending = false;
                    next.reset_phase = ProtocolSchedulerResetPhase::None;
                    next.pages_seen = 0;
                    true
                } else {
                    false
                }
            }
            ProtocolSchedulerEvent::Hint => {
                if next.phase == ProtocolSchedulerPhase::Stopped || !next.online {
                    false
                } else {
                    if next.phase == ProtocolSchedulerPhase::Offline {
                        next.phase = ProtocolSchedulerPhase::Idle;
                    }
                    if next.cycle_pending {
                        next.wake_pending = true;
                    } else {
                        next.stale_timer_pending |= next.timer_pending;
                        next.timer_pending = true;
                        next.timer_generation = next.generation;
                    }
                    true
                }
            }
            ProtocolSchedulerEvent::GoOffline => {
                if next.phase == ProtocolSchedulerPhase::Stopped || !next.online {
                    false
                } else if let Some(generation) = next.generation.checked_add(1) {
                    next.phase = ProtocolSchedulerPhase::Offline;
                    next.online = false;
                    next.generation = generation;
                    next.stale_timer_pending |= next.timer_pending;
                    next.timer_pending = false;
                    next.network_active = false;
                    next.wake_pending = false;
                    next.reset_phase = ProtocolSchedulerResetPhase::None;
                    next.pages_seen = 0;
                    true
                } else {
                    false
                }
            }
            ProtocolSchedulerEvent::GoOnline => {
                if next.phase != ProtocolSchedulerPhase::Offline || next.online {
                    false
                } else {
                    next.phase = ProtocolSchedulerPhase::Idle;
                    next.online = true;
                    next.timer_pending = !next.cycle_pending;
                    next.timer_generation = next.generation;
                    next.wake_pending = next.cycle_pending;
                    true
                }
            }
            ProtocolSchedulerEvent::TimerFire => {
                if !current_timer_enabled(&next) || next.cycle_pending {
                    false
                } else {
                    next.phase = ProtocolSchedulerPhase::Syncing;
                    next.timer_pending = false;
                    next.cycle_pending = true;
                    next.cycle_generation = next.generation;
                    next.network_active = true;
                    next.wake_pending = false;
                    next.reset_phase = ProtocolSchedulerResetPhase::None;
                    next.pages_seen = 0;
                    true
                }
            }
            ProtocolSchedulerEvent::TimerJoin => {
                if !current_timer_enabled(&next) || !next.cycle_pending {
                    false
                } else {
                    next.timer_pending = false;
                    next.wake_pending = true;
                    true
                }
            }
            ProtocolSchedulerEvent::StaleTimerFire => {
                if !next.stale_timer_pending {
                    false
                } else {
                    next.stale_timer_pending = false;
                    true
                }
            }
            ProtocolSchedulerEvent::PageMore => {
                if !current_cycle_enabled(&next)
                    || next.reset_phase == ProtocolSchedulerResetPhase::SnapshotRequested
                    || next.pages_seen >= Self::MAX_PAGES_PER_REFINEMENT_TRACE
                {
                    false
                } else {
                    next.pages_seen += 1;
                    true
                }
            }
            ProtocolSchedulerEvent::BeginReset => {
                if !current_cycle_enabled(&next)
                    || next.reset_phase != ProtocolSchedulerResetPhase::None
                {
                    false
                } else {
                    next.reset_phase = ProtocolSchedulerResetPhase::SnapshotRequested;
                    true
                }
            }
            ProtocolSchedulerEvent::FinishReset => {
                if !current_cycle_enabled(&next)
                    || next.reset_phase != ProtocolSchedulerResetPhase::SnapshotRequested
                {
                    false
                } else {
                    next.reset_phase = ProtocolSchedulerResetPhase::SnapshotInstalled;
                    true
                }
            }
            ProtocolSchedulerEvent::CycleSuccess => {
                if !settle_enabled(&next) {
                    false
                } else {
                    settle_success(&mut next, false);
                    true
                }
            }
            ProtocolSchedulerEvent::CycleSuccessMore => {
                if !settle_enabled(&next) {
                    false
                } else {
                    settle_success(&mut next, true);
                    true
                }
            }
            ProtocolSchedulerEvent::CycleRetryableFailure => {
                if !current_cycle_enabled(&next) {
                    false
                } else {
                    next.phase = ProtocolSchedulerPhase::Backoff;
                    next.timer_pending = true;
                    next.timer_generation = next.generation;
                    next.cycle_pending = false;
                    next.network_active = false;
                    next.wake_pending = false;
                    next.consecutive_failures = next
                        .consecutive_failures
                        .saturating_add(1)
                        .min(Self::MAX_CONSECUTIVE_FAILURES);
                    next.reset_phase = ProtocolSchedulerResetPhase::None;
                    next.pages_seen = 0;
                    true
                }
            }
            ProtocolSchedulerEvent::CyclePermanentFailure
            | ProtocolSchedulerEvent::MalformedResponse => {
                if !current_cycle_enabled(&next) {
                    false
                } else {
                    next.phase = ProtocolSchedulerPhase::Error;
                    next.timer_pending = false;
                    next.cycle_pending = false;
                    next.network_active = false;
                    next.wake_pending = false;
                    next.reset_phase = ProtocolSchedulerResetPhase::None;
                    next.pages_seen = 0;
                    true
                }
            }
            ProtocolSchedulerEvent::StaleCycleSuccess
            | ProtocolSchedulerEvent::StaleCycleFailure => {
                if !next.cycle_pending || next.cycle_generation == next.generation {
                    false
                } else {
                    if next.phase == ProtocolSchedulerPhase::Idle {
                        next.timer_pending = true;
                        next.timer_generation = next.generation;
                    }
                    next.cycle_pending = false;
                    next.wake_pending = false;
                    true
                }
            }
        };

        if !enabled || !state_is_safe(&next) {
            return Err(ProtocolSchedulerTransitionError {
                event,
                phase: self.state.phase,
            });
        }
        self.state = next;
        Ok(&self.state)
    }
}

fn current_timer_enabled(state: &ProtocolSchedulerState) -> bool {
    state.phase != ProtocolSchedulerPhase::Stopped
        && state.online
        && state.timer_pending
        && state.timer_generation == state.generation
}

fn current_cycle_enabled(state: &ProtocolSchedulerState) -> bool {
    state.phase == ProtocolSchedulerPhase::Syncing
        && state.network_active
        && state.cycle_pending
        && state.cycle_generation == state.generation
}

fn settle_enabled(state: &ProtocolSchedulerState) -> bool {
    current_cycle_enabled(state)
        && state.reset_phase != ProtocolSchedulerResetPhase::SnapshotRequested
}

fn settle_success(state: &mut ProtocolSchedulerState, has_more: bool) {
    state.phase = ProtocolSchedulerPhase::Idle;
    state.timer_pending = has_more || state.wake_pending;
    state.timer_generation = state.generation;
    state.cycle_pending = false;
    state.network_active = false;
    state.wake_pending = false;
    state.consecutive_failures = 0;
    state.reset_phase = ProtocolSchedulerResetPhase::None;
    state.pages_seen = 0;
}

fn state_is_safe(state: &ProtocolSchedulerState) -> bool {
    let network_owned = !state.network_active
        || (state.phase == ProtocolSchedulerPhase::Syncing
            && state.online
            && state.cycle_pending
            && state.cycle_generation == state.generation);
    let inactive_boundaries = (state.phase != ProtocolSchedulerPhase::Stopped
        || !state.network_active)
        && (state.phase != ProtocolSchedulerPhase::Offline || !state.network_active);
    let reset_ordered =
        state.reset_phase == ProtocolSchedulerResetPhase::None || current_cycle_enabled(state);
    let timer_owned = !state.timer_pending || current_timer_enabled(state);
    network_owned && inactive_boundaries && reset_ordered && timer_owned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_transition_does_not_mutate_state() {
        let mut scheduler = ProtocolSyncScheduler::new();
        let before = scheduler.state().clone();
        assert!(scheduler.apply(ProtocolSchedulerEvent::TimerFire).is_err());
        assert_eq!(scheduler.state(), &before);
    }

    #[test]
    fn stale_timer_and_cycle_settlements_cannot_overwrite_new_intent() {
        let mut scheduler = ProtocolSyncScheduler::new();
        scheduler.apply(ProtocolSchedulerEvent::Start).unwrap();
        // Replacing the first timer leaves a callback that must later be
        // recognized as stale.
        scheduler.apply(ProtocolSchedulerEvent::Hint).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::TimerFire).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::Stop).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::Start).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::TimerJoin).unwrap();
        scheduler
            .apply(ProtocolSchedulerEvent::StaleTimerFire)
            .unwrap();
        scheduler
            .apply(ProtocolSchedulerEvent::StaleCycleFailure)
            .unwrap();
        assert_eq!(scheduler.state().phase, ProtocolSchedulerPhase::Idle);
        assert_eq!(scheduler.state().consecutive_failures, 0);
        assert!(scheduler.state().timer_pending);
    }

    #[test]
    fn online_recovery_coalesces_behind_a_stale_cycle() {
        let mut scheduler = ProtocolSyncScheduler::new();
        scheduler.apply(ProtocolSchedulerEvent::Start).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::TimerFire).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::GoOffline).unwrap();
        scheduler.apply(ProtocolSchedulerEvent::GoOnline).unwrap();

        assert_eq!(scheduler.state().phase, ProtocolSchedulerPhase::Idle);
        assert!(scheduler.state().cycle_pending);
        assert!(scheduler.state().wake_pending);
        assert!(!scheduler.state().timer_pending);

        scheduler
            .apply(ProtocolSchedulerEvent::StaleCycleSuccess)
            .unwrap();
        assert!(scheduler.state().timer_pending);
    }
}
