// Finite scheduler model for the protocol-v1 mobile and desktop sync loops.
//
// Network, timer, and callback delivery are explicit environment actions. An
// intent generation makes callbacks from a stopped/offline predecessor stale;
// firing a cancelled timer or settling such a callback may only stutter the
// current observable scheduler projection.
module protocol_sync_scheduler {
  type Phase = Stopped | Idle | Syncing | Offline | Backoff | Error
  type ResetPhase = NoReset | SnapshotRequested | SnapshotInstalled

  type State = {
    phase: Phase,
    online: bool,
    generation: int,
    timer_pending: bool,
    timer_generation: int,
    stale_timer_pending: bool,
    cycle_pending: bool,
    cycle_generation: int,
    network_active: bool,
    wake_pending: bool,
    consecutive_failures: int,
    reset_phase: ResetPhase,
    pages_seen: int,
    saw_stop_during_cycle: bool,
    saw_trailing_wake: bool,
    saw_offline_during_cycle: bool,
    saw_online_recovery: bool,
    saw_retryable_failure: bool,
    saw_permanent_failure: bool,
    saw_reset: bool,
    saw_malformed_response: bool,
    saw_paging_rerun: bool,
    saw_stale_cycle: bool,
    saw_stale_timer: bool,
  }

  var s: State

  val max_generation = 4
  val max_failures = 31
  val max_pages = 2

  action init = {
    s' = {
      phase: Stopped,
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
      reset_phase: NoReset,
      pages_seen: 0,
      saw_stop_during_cycle: false,
      saw_trailing_wake: false,
      saw_offline_during_cycle: false,
      saw_online_recovery: false,
      saw_retryable_failure: false,
      saw_permanent_failure: false,
      saw_reset: false,
      saw_malformed_response: false,
      saw_paging_rerun: false,
      saw_stale_cycle: false,
      saw_stale_timer: false,
    }
  }

  action start = all {
    s.phase == Stopped,
    s.generation < max_generation,
    s' = {
      ...s,
      phase: if (s.online) Idle else Offline,
      generation: s.generation + 1,
      timer_pending: s.online,
      timer_generation: s.generation + 1,
      wake_pending: false,
      consecutive_failures: 0,
      reset_phase: NoReset,
      pages_seen: 0,
    },
  }

  action stop = all {
    s.phase != Stopped,
    s.generation < max_generation,
    s' = {
      ...s,
      phase: Stopped,
      generation: s.generation + 1,
      timer_pending: false,
      stale_timer_pending: s.stale_timer_pending or s.timer_pending,
      network_active: false,
      wake_pending: false,
      reset_phase: NoReset,
      pages_seen: 0,
      saw_stop_during_cycle: s.saw_stop_during_cycle or s.cycle_pending,
    },
  }

  action hint = all {
    s.phase != Stopped,
    s.online,
    s' = {
      ...s,
      phase: if (s.phase == Offline) Idle else s.phase,
      timer_pending: if (s.cycle_pending) s.timer_pending else true,
      timer_generation: if (s.cycle_pending) s.timer_generation else s.generation,
      stale_timer_pending:
        s.stale_timer_pending or and { s.timer_pending, not(s.cycle_pending) },
      wake_pending: s.cycle_pending or s.wake_pending,
      saw_trailing_wake: s.saw_trailing_wake or s.cycle_pending,
    },
  }

  action go_offline = all {
    s.phase != Stopped,
    s.online,
    s.generation < max_generation,
    s' = {
      ...s,
      phase: Offline,
      online: false,
      generation: s.generation + 1,
      timer_pending: false,
      stale_timer_pending: s.stale_timer_pending or s.timer_pending,
      network_active: false,
      wake_pending: false,
      reset_phase: NoReset,
      pages_seen: 0,
      saw_offline_during_cycle: s.saw_offline_during_cycle or s.cycle_pending,
    },
  }

  action go_online = all {
    s.phase == Offline,
    not(s.online),
    s' = {
      ...s,
      phase: Idle,
      online: true,
      timer_pending: not(s.cycle_pending),
      timer_generation: s.generation,
      wake_pending: s.cycle_pending,
      saw_online_recovery: true,
    },
  }

  action timer_fire = all {
    s.phase != Stopped,
    s.online,
    s.timer_pending,
    s.timer_generation == s.generation,
    not(s.cycle_pending),
    s' = {
      ...s,
      phase: Syncing,
      timer_pending: false,
      cycle_pending: true,
      cycle_generation: s.generation,
      network_active: true,
      wake_pending: false,
      reset_phase: NoReset,
      pages_seen: 0,
    },
  }

  action timer_join = all {
    s.phase != Stopped,
    s.online,
    s.timer_pending,
    s.timer_generation == s.generation,
    s.cycle_pending,
    s' = {
      ...s,
      timer_pending: false,
      wake_pending: true,
      saw_trailing_wake: true,
    },
  }

  action stale_timer_fire = all {
    s.stale_timer_pending,
    s' = { ...s, stale_timer_pending: false, saw_stale_timer: true },
  }

  action page_more = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s.reset_phase != SnapshotRequested,
    s.pages_seen < max_pages,
    s' = { ...s, pages_seen: s.pages_seen + 1 },
  }

  action begin_reset = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s.reset_phase == NoReset,
    s' = { ...s, reset_phase: SnapshotRequested, saw_reset: true },
  }

  action finish_reset = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s.reset_phase == SnapshotRequested,
    s' = { ...s, reset_phase: SnapshotInstalled },
  }

  action cycle_success = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s.reset_phase != SnapshotRequested,
    s' = {
      ...s,
      phase: Idle,
      timer_pending: s.wake_pending,
      timer_generation: s.generation,
      cycle_pending: false,
      network_active: false,
      wake_pending: false,
      consecutive_failures: 0,
      reset_phase: NoReset,
      pages_seen: 0,
    },
  }

  action cycle_success_more = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s.reset_phase != SnapshotRequested,
    s' = {
      ...s,
      phase: Idle,
      timer_pending: true,
      timer_generation: s.generation,
      cycle_pending: false,
      network_active: false,
      wake_pending: false,
      consecutive_failures: 0,
      reset_phase: NoReset,
      pages_seen: 0,
      saw_paging_rerun: true,
    },
  }

  action cycle_retryable_failure = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s' = {
      ...s,
      phase: Backoff,
      timer_pending: true,
      timer_generation: s.generation,
      cycle_pending: false,
      network_active: false,
      wake_pending: false,
      consecutive_failures:
        if (s.consecutive_failures < max_failures)
          s.consecutive_failures + 1
        else
          max_failures,
      reset_phase: NoReset,
      pages_seen: 0,
      saw_retryable_failure: true,
    },
  }

  action cycle_permanent_failure = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s' = {
      ...s,
      phase: Error,
      timer_pending: false,
      cycle_pending: false,
      network_active: false,
      wake_pending: false,
      reset_phase: NoReset,
      pages_seen: 0,
      saw_permanent_failure: true,
    },
  }

  action malformed_response = all {
    s.phase == Syncing,
    s.network_active,
    s.cycle_pending,
    s.cycle_generation == s.generation,
    s' = {
      ...s,
      phase: Error,
      timer_pending: false,
      cycle_pending: false,
      network_active: false,
      wake_pending: false,
      reset_phase: NoReset,
      pages_seen: 0,
      saw_malformed_response: true,
    },
  }

  action stale_cycle_success = all {
    s.cycle_pending,
    s.cycle_generation != s.generation,
    s' = {
      ...s,
      timer_pending: if (s.phase == Idle) true else s.timer_pending,
      timer_generation: if (s.phase == Idle) s.generation else s.timer_generation,
      cycle_pending: false,
      wake_pending: false,
      saw_stale_cycle: true,
    },
  }

  action stale_cycle_failure = all {
    s.cycle_pending,
    s.cycle_generation != s.generation,
    s' = {
      ...s,
      timer_pending: if (s.phase == Idle) true else s.timer_pending,
      timer_generation: if (s.phase == Idle) s.generation else s.timer_generation,
      cycle_pending: false,
      wake_pending: false,
      saw_stale_cycle: true,
    },
  }

  action idle = s' = s

  action step = any {
    start,
    stop,
    hint,
    go_offline,
    go_online,
    timer_fire,
    timer_join,
    stale_timer_fire,
    page_more,
    begin_reset,
    finish_reset,
    cycle_success,
    cycle_success_more,
    cycle_retryable_failure,
    cycle_permanent_failure,
    malformed_response,
    stale_cycle_success,
    stale_cycle_failure,
    idle,
  }

  val phase_owns_network =
    not(s.network_active) or and {
      s.phase == Syncing,
      s.online,
      s.cycle_pending,
      s.cycle_generation == s.generation,
    }

  val stopped_and_offline_start_no_work = and {
    s.phase != Stopped or not(s.network_active),
    s.phase != Offline or not(s.network_active),
  }

  val failure_count_is_bounded = and {
    s.consecutive_failures >= 0,
    s.consecutive_failures <= max_failures,
  }

  val reset_is_ordered =
    s.reset_phase == NoReset or and {
      s.phase == Syncing,
      s.network_active,
      s.cycle_pending,
      s.cycle_generation == s.generation,
    }

  val current_timer_is_owned =
    not(s.timer_pending) or and {
      s.phase != Stopped,
      s.online,
      s.timer_generation == s.generation,
    }

  val scheduler_safety = and {
    phase_owns_network,
    stopped_and_offline_start_no_work,
    failure_count_is_bounded,
    reset_is_ordered,
    current_timer_is_owned,
  }

  action settle_current_cycle = any {
    cycle_success,
    cycle_success_more,
    cycle_retryable_failure,
    cycle_permanent_failure,
    malformed_response,
  }

  action fire_current_timer = any { timer_fire, timer_join }

  // Progress is conditional on the host delivering current timers and on the
  // transport/callback stack settling an active cycle. Connectivity is not
  // assumed fair: there is intentionally no unconditional eventually-online
  // property.
  temporal scheduler_environment_is_fair = and {
    fire_current_timer.strongFair(Set(s)),
    settle_current_cycle.strongFair(Set(s)),
    finish_reset.strongFair(Set(s)),
  }

  temporal scheduled_work_eventually_runs =
    scheduler_environment_is_fair.implies(
      and { s.timer_pending, s.online }.leadsTo(not(s.timer_pending))
    )

  temporal active_cycle_eventually_settles =
    scheduler_environment_is_fair.implies(
      s.network_active.leadsTo(not(s.network_active))
    )

  temporal retry_timer_eventually_fires =
    scheduler_environment_is_fair.implies(
      (s.phase == Backoff).leadsTo(s.phase != Backoff)
    )

  val stop_during_cycle_reached = s.saw_stop_during_cycle
  val trailing_wake_reached = s.saw_trailing_wake
  val offline_during_cycle_reached = s.saw_offline_during_cycle
  val online_recovery_reached = s.saw_online_recovery
  val retryable_failure_reached = s.saw_retryable_failure
  val permanent_failure_reached = s.saw_permanent_failure
  val reset_reached = s.saw_reset
  val malformed_response_reached = s.saw_malformed_response
  val paging_rerun_reached = s.saw_paging_rerun
  val stale_cycle_reached = s.saw_stale_cycle
  val stale_timer_reached = s.saw_stale_timer
}
