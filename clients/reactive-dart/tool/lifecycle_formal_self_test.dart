import 'package:opto_sync_reactive/opto_sync_reactive.dart';

String _key(SyncLifecycleSnapshot state) => <Object>[
  state.phase.name,
  state.wakePending,
  state.closeRequested,
  state.cancelRequested,
  state.permitHeld,
].join('|');

void main() {
  final initial = const SyncLifecycleSnapshot.initial();
  final pending = <SyncLifecycleSnapshot>[initial];
  final reached = <String, SyncLifecycleSnapshot>{_key(initial): initial};
  var closeDuringAcquireReached = false;
  var trailingWakeReached = false;
  var cancellationReached = false;
  var examinedPairs = 0;

  while (pending.isNotEmpty) {
    final state = pending.removeLast();
    if (!state.isValid) throw StateError('reached invalid state: $state');
    for (final event in SyncLifecycleEvent.values) {
      examinedPairs += 1;
      final next = SyncLifecycleMachine.transition(state, event);
      if (next == null) continue;
      if (!next.isValid) {
        throw StateError('$state + ${event.name} produced invalid $next');
      }
      closeDuringAcquireReached |=
          state.phase == SyncLifecyclePhase.acquiring &&
          event == SyncLifecycleEvent.close &&
          next.closeRequested;
      trailingWakeReached |=
          state.phase == SyncLifecyclePhase.running &&
          event == SyncLifecycleEvent.wake &&
          next.wakePending;
      cancellationReached |=
          state.phase == SyncLifecyclePhase.running &&
          event == SyncLifecycleEvent.cancel &&
          next.cancelRequested;
      final key = _key(next);
      if (!reached.containsKey(key)) {
        reached[key] = next;
        pending.add(next);
      }
    }
  }

  if (!closeDuringAcquireReached ||
      !trailingWakeReached ||
      !cancellationReached) {
    throw StateError('required lifecycle failure witnesses were unreachable');
  }

  final machine = SyncLifecycleMachine();
  final before = machine.state;
  try {
    machine.apply(SyncLifecycleEvent.beginAcquire);
    throw StateError('undefined transition unexpectedly succeeded');
  } on SyncLifecycleTransitionError {
    if (!identical(machine.state, before)) {
      throw StateError('rejected transition mutated the lifecycle state');
    }
  }

  print(
    'exhaustively checked $examinedPairs event pairs across '
    '${reached.length} reachable lifecycle states',
  );
}
