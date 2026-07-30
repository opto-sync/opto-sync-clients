import 'dart:async';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';
import 'package:rxdart/rxdart.dart';

Future<void> _waitFor(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('background contract condition did not complete');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

Future<void> _cooperativeCancellation() async {
  final release = Completer<void>();
  late BackgroundSyncContext observed;
  final runner = BackgroundSyncRunner<int>(
    budget: const Duration(seconds: 2),
    syncOnce: (context) async {
      observed = context;
      await release.future;
      context.throwIfCancelled();
      return 1;
    },
  );

  final first = runner.runOnce();
  final second = runner.runOnce();
  if (!identical(first, second)) {
    throw StateError('one mobile worker exposed two in-flight futures');
  }
  runner.cancel('test scheduler stop');
  if (!observed.isCancelled ||
      observed.cancellationReason != 'test scheduler stop') {
    throw StateError('native cancellation did not reach the Dart sync context');
  }
  release.complete();
  try {
    await first;
    throw StateError('cancelled mobile cycle unexpectedly succeeded');
  } on StateError catch (error) {
    if (!error.toString().contains('test scheduler stop')) rethrow;
  }
}

Future<void> _trailingWakeIsSerialized() async {
  final local = PublishSubject<BackgroundWakeReason>();
  final remote = PublishSubject<BackgroundWakeReason>();
  var cycles = 0;
  var active = 0;
  var maxActive = 0;
  final runner = BackgroundSyncRunner<int>(
    budget: const Duration(seconds: 2),
    syncOnce: (context) async {
      context.throwIfCancelled();
      cycles += 1;
      active += 1;
      if (active > maxActive) maxActive = active;
      await Future<void>.delayed(const Duration(milliseconds: 40));
      context.throwIfCancelled();
      active -= 1;
      return cycles;
    },
  );
  final outcomes = <BackgroundSyncOutcome<int>>[];
  final stream = createBackgroundSyncOutcomes<int>(
    wakeStreams: <Stream<BackgroundWakeReason>>[local, remote],
    runner: runner,
    coalesce: const Duration(milliseconds: 5),
  );
  final subscription = stream.listen(outcomes.add);

  local.add(BackgroundWakeReason.localMutation);
  await Future<void>.delayed(const Duration(milliseconds: 12));
  remote.add(BackgroundWakeReason.remoteHint);
  await _waitFor(() => outcomes.length == 2);

  if (cycles != 2 || maxActive != 1 || outcomes.any((item) => !item.ok)) {
    throw StateError(
      'trailing mobile wake contract failed: cycles=$cycles '
      'maxActive=$maxActive outcomes=${outcomes.length}',
    );
  }
  await subscription.cancel();
  await local.close();
  await remote.close();
}

Future<void> main() async {
  await _cooperativeCancellation();
  await _trailingWakeIsSerialized();
  print('mobile background cancellation and trailing-wake contracts passed');
}
