/// Formally modeled lifecycle shared by mobile and desktop sync runners.
///
/// The transition relation is specified in
/// `formal/mobile_desktop_lifecycle.qnt`. Runners must use [apply] for every
/// ownership change so an implementation drift fails closed as a
/// [SyncLifecycleTransitionError] instead of creating an unmodeled state.
enum SyncLifecyclePhase { idle, acquiring, running, releasing, closed }

enum SyncLifecycleEvent {
  wake,
  join,
  beginAcquire,
  acquireGranted,
  acquireDeferred,
  cancel,
  cycleSettled,
  releaseSettled,
  close,
  processAbort,
}

final class SyncLifecycleSnapshot {
  const SyncLifecycleSnapshot({
    required this.phase,
    required this.wakePending,
    required this.closeRequested,
    required this.cancelRequested,
    required this.permitHeld,
  });

  const SyncLifecycleSnapshot.initial()
    : phase = SyncLifecyclePhase.idle,
      wakePending = false,
      closeRequested = false,
      cancelRequested = false,
      permitHeld = false;

  final SyncLifecyclePhase phase;
  final bool wakePending;
  final bool closeRequested;
  final bool cancelRequested;

  /// A local execution permit, backed by a durable fence on desktop.
  final bool permitHeld;

  bool get isValid {
    final activePermit =
        phase == SyncLifecyclePhase.running ||
        phase == SyncLifecyclePhase.releasing;
    if (permitHeld != activePermit) return false;
    if (phase == SyncLifecyclePhase.closed) {
      return closeRequested && !wakePending && !cancelRequested && !permitHeld;
    }
    if (closeRequested && wakePending) return false;
    if (cancelRequested && phase != SyncLifecyclePhase.running) return false;
    return true;
  }

  SyncLifecycleSnapshot copyWith({
    SyncLifecyclePhase? phase,
    bool? wakePending,
    bool? closeRequested,
    bool? cancelRequested,
    bool? permitHeld,
  }) => SyncLifecycleSnapshot(
    phase: phase ?? this.phase,
    wakePending: wakePending ?? this.wakePending,
    closeRequested: closeRequested ?? this.closeRequested,
    cancelRequested: cancelRequested ?? this.cancelRequested,
    permitHeld: permitHeld ?? this.permitHeld,
  );

  @override
  String toString() =>
      'SyncLifecycleSnapshot(phase: ${phase.name}, '
      'wakePending: $wakePending, closeRequested: $closeRequested, '
      'cancelRequested: $cancelRequested, permitHeld: $permitHeld)';
}

final class SyncLifecycleTransitionError implements Exception {
  const SyncLifecycleTransitionError(this.before, this.event);

  final SyncLifecycleSnapshot before;
  final SyncLifecycleEvent event;

  @override
  String toString() =>
      'undefined opto-sync lifecycle transition: '
      '${before.phase.name} + ${event.name} ($before)';
}

/// Small deterministic machine used directly by production runners.
///
/// Undefined events never guess a recovery path: [apply] throws and leaves the
/// state unchanged. Public idempotence (for example, calling `close` twice) is
/// handled at the API boundary before entering this machine.
final class SyncLifecycleMachine {
  SyncLifecycleSnapshot _state = const SyncLifecycleSnapshot.initial();

  SyncLifecycleSnapshot get state => _state;

  bool allows(SyncLifecycleEvent event) => _next(_state, event) != null;

  SyncLifecycleSnapshot apply(SyncLifecycleEvent event) {
    final next = _next(_state, event);
    if (next == null) throw SyncLifecycleTransitionError(_state, event);
    if (!next.isValid) {
      throw StateError('lifecycle transition produced an invalid state: $next');
    }
    _state = next;
    return next;
  }

  static SyncLifecycleSnapshot? transition(
    SyncLifecycleSnapshot state,
    SyncLifecycleEvent event,
  ) {
    if (!state.isValid) return null;
    return _next(state, event);
  }

  static SyncLifecycleSnapshot? _next(
    SyncLifecycleSnapshot state,
    SyncLifecycleEvent event,
  ) {
    switch (event) {
      case SyncLifecycleEvent.wake:
        if (state.phase == SyncLifecyclePhase.closed || state.closeRequested) {
          return null;
        }
        return state.copyWith(wakePending: true);
      case SyncLifecycleEvent.join:
        if (state.phase != SyncLifecyclePhase.acquiring &&
            state.phase != SyncLifecyclePhase.running &&
            state.phase != SyncLifecyclePhase.releasing) {
          return null;
        }
        return state;
      case SyncLifecycleEvent.beginAcquire:
        if (state.phase != SyncLifecyclePhase.idle ||
            !state.wakePending ||
            state.closeRequested) {
          return null;
        }
        return state.copyWith(
          phase: SyncLifecyclePhase.acquiring,
          wakePending: false,
        );
      case SyncLifecycleEvent.acquireGranted:
        if (state.phase != SyncLifecyclePhase.acquiring) return null;
        return state.copyWith(
          phase: state.closeRequested
              ? SyncLifecyclePhase.releasing
              : SyncLifecyclePhase.running,
          permitHeld: true,
          cancelRequested: false,
        );
      case SyncLifecycleEvent.acquireDeferred:
        if (state.phase != SyncLifecyclePhase.acquiring) return null;
        return state.copyWith(
          phase: state.closeRequested
              ? SyncLifecyclePhase.closed
              : SyncLifecyclePhase.idle,
          wakePending: state.closeRequested ? false : state.wakePending,
          cancelRequested: false,
          permitHeld: false,
        );
      case SyncLifecycleEvent.cancel:
        if (state.phase != SyncLifecyclePhase.running) return null;
        return state.copyWith(cancelRequested: true);
      case SyncLifecycleEvent.cycleSettled:
        if (state.phase != SyncLifecyclePhase.running || !state.permitHeld) {
          return null;
        }
        return state.copyWith(
          phase: SyncLifecyclePhase.releasing,
          cancelRequested: false,
        );
      case SyncLifecycleEvent.releaseSettled:
        if (state.phase != SyncLifecyclePhase.releasing || !state.permitHeld) {
          return null;
        }
        return state.copyWith(
          phase: state.closeRequested
              ? SyncLifecyclePhase.closed
              : SyncLifecyclePhase.idle,
          wakePending: state.closeRequested ? false : state.wakePending,
          cancelRequested: false,
          permitHeld: false,
        );
      case SyncLifecycleEvent.close:
        if (state.phase == SyncLifecyclePhase.closed) return null;
        if (state.phase == SyncLifecyclePhase.idle) {
          return state.copyWith(
            phase: SyncLifecyclePhase.closed,
            wakePending: false,
            closeRequested: true,
            cancelRequested: false,
          );
        }
        return state.copyWith(
          wakePending: false,
          closeRequested: true,
          cancelRequested: state.phase == SyncLifecyclePhase.running,
        );
      case SyncLifecycleEvent.processAbort:
        if (state.phase != SyncLifecyclePhase.acquiring &&
            state.phase != SyncLifecyclePhase.running &&
            state.phase != SyncLifecyclePhase.releasing) {
          return null;
        }
        return state.copyWith(
          phase: state.closeRequested
              ? SyncLifecyclePhase.closed
              : SyncLifecyclePhase.idle,
          wakePending: false,
          cancelRequested: false,
          permitHeld: false,
        );
    }
  }
}
