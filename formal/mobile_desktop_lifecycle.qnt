// Finite transition system for mobile and desktop background-sync ownership.
//
// The production Dart and Rust runners implement this relation directly. The
// model deliberately separates an isolate/process-local execution permit from
// the durable desktop fence: a process abort drops the local permit while the
// durable store continues to exclude a replacement until release or expiry.
module mobile_desktop_lifecycle {
  type Phase = Idle | Acquiring | Running | Releasing | Closed

  type State = {
    phase: Phase,
    wake_pending: bool,
    close_requested: bool,
    cancel_requested: bool,
    permit_held: bool,
    saw_close_during_acquire: bool,
    saw_trailing_wake: bool,
    saw_cancellation: bool,
  }

  var s: State

  action init = {
    s' = {
      phase: Idle,
      wake_pending: false,
      close_requested: false,
      cancel_requested: false,
      permit_held: false,
      saw_close_during_acquire: false,
      saw_trailing_wake: false,
      saw_cancellation: false,
    }
  }

  action wake = all {
    s.phase != Closed,
    not(s.close_requested),
    s' = {
      ...s,
      wake_pending: true,
      saw_trailing_wake: s.saw_trailing_wake or s.phase == Running,
    },
  }

  action join = all {
    or { s.phase == Acquiring, s.phase == Running, s.phase == Releasing },
    s' = s,
  }

  action begin_acquire = all {
    s.phase == Idle,
    s.wake_pending,
    not(s.close_requested),
    s' = { ...s, phase: Acquiring, wake_pending: false },
  }

  action acquire_granted = all {
    s.phase == Acquiring,
    s' = {
      ...s,
      phase: if (s.close_requested) Releasing else Running,
      permit_held: true,
      cancel_requested: false,
    },
  }

  action acquire_deferred = all {
    s.phase == Acquiring,
    s' = {
      ...s,
      phase: if (s.close_requested) Closed else Idle,
      wake_pending: if (s.close_requested) false else s.wake_pending,
      cancel_requested: false,
      permit_held: false,
    },
  }

  action cancel = all {
    s.phase == Running,
    s' = {
      ...s,
      cancel_requested: true,
      saw_cancellation: true,
    },
  }

  action cycle_settled = all {
    s.phase == Running,
    s.permit_held,
    s' = { ...s, phase: Releasing, cancel_requested: false },
  }

  action release_settled = all {
    s.phase == Releasing,
    s.permit_held,
    s' = {
      ...s,
      phase: if (s.close_requested) Closed else Idle,
      wake_pending: if (s.close_requested) false else s.wake_pending,
      cancel_requested: false,
      permit_held: false,
    },
  }

  // Keep this as one named transition rather than a nested `any`: Quint's MBT
  // instrumentation cannot attribute a selected inner branch to the outer
  // action, which would make close behavior invisible to refinement replay.
  action request_close = all {
    s.phase != Closed,
    s' = {
      ...s,
      phase: if (s.phase == Idle) Closed else s.phase,
      wake_pending: false,
      close_requested: true,
      cancel_requested: s.phase == Running,
      saw_close_during_acquire:
        s.saw_close_during_acquire or s.phase == Acquiring,
      saw_cancellation: s.saw_cancellation or s.phase == Running,
    },
  }

  action process_abort = all {
    or { s.phase == Acquiring, s.phase == Running, s.phase == Releasing },
    s' = {
      ...s,
      phase: if (s.close_requested) Closed else Idle,
      wake_pending: false,
      cancel_requested: false,
      permit_held: false,
    },
  }

  action idle = s' = s

  action settle_acquire = any { acquire_granted, acquire_deferred }

  action step = any {
    wake,
    join,
    begin_acquire,
    acquire_granted,
    acquire_deferred,
    cancel,
    cycle_settled,
    release_settled,
    request_close,
    process_abort,
    idle,
  }

  val permit_matches_phase =
    s.permit_held == or { s.phase == Running, s.phase == Releasing }

  val closed_is_terminal = or {
    s.phase != Closed,
    and {
      s.close_requested,
      not(s.wake_pending),
      not(s.cancel_requested),
      not(s.permit_held),
    },
  }

  val closing_rejects_wakes = not(s.close_requested) or not(s.wake_pending)

  val cancellation_is_controlled =
    not(s.cancel_requested) or s.phase == Running

  val lifecycle_safety = and {
    permit_matches_phase,
    closed_is_terminal,
    closing_rejects_wakes,
    cancellation_is_controlled,
  }

  // These progress claims are conditional on the environment eventually
  // settling permit acquisition, the user callback, and durable-fence release.
  // `process_abort` remains an unrestricted fault: it also leaves Acquiring or
  // Running, and a close request is terminal across an abort.
  temporal lifecycle_progress_is_fair = and {
    settle_acquire.strongFair(Set(s)),
    cycle_settled.strongFair(Set(s)),
    release_settled.strongFair(Set(s)),
  }

  temporal acquisition_eventually_settles =
    lifecycle_progress_is_fair.implies(
      (s.phase == Acquiring).leadsTo(s.phase != Acquiring)
    )

  temporal running_cycle_eventually_settles =
    lifecycle_progress_is_fair.implies(
      (s.phase == Running).leadsTo(s.phase != Running)
    )

  temporal close_eventually_terminates =
    lifecycle_progress_is_fair.implies(
      s.close_requested.leadsTo(s.phase == Closed)
    )

  val close_during_acquire_reached = s.saw_close_during_acquire
  val trailing_wake_reached = s.saw_trailing_wake
  val cancellation_reached = s.saw_cancellation
}
