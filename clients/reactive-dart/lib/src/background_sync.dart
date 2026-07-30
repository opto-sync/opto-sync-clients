import 'dart:async';

import 'package:rxdart/rxdart.dart';

enum BackgroundWakeReason {
  localMutation,
  remoteHint,
  connectivity,
  operatingSystem,
  manual,
}

typedef BackgroundSyncCycle<R> = Future<R> Function(Duration budget);

/// One bounded, single-flight HTTP push/pull cycle for a worker isolate.
///
/// Android WorkManager and Apple BGTaskScheduler may stop a task at any time.
/// The callback must therefore use durable queue/checkpoint state, remain
/// idempotent, and finish within [budget]. It must not own a permanent socket.
final class BackgroundSyncRunner<R> {
  BackgroundSyncRunner({
    required BackgroundSyncCycle<R> syncOnce,
    this.budget = const Duration(seconds: 25),
  }) : _syncOnce = syncOnce {
    if (budget < const Duration(seconds: 1) ||
        budget > const Duration(minutes: 10)) {
      throw ArgumentError.value(
        budget,
        'budget',
        'must be from one second through ten minutes',
      );
    }
  }

  final BackgroundSyncCycle<R> _syncOnce;
  final Duration budget;
  Future<R>? _inFlight;

  Future<R> runOnce() {
    final running = _inFlight;
    if (running != null) return running;
    final next = _syncOnce(budget).timeout(
      budget,
      onTimeout: () => throw TimeoutException(
        'opto-sync background cycle exceeded $budget',
        budget,
      ),
    );
    _inFlight = next.whenComplete(() => _inFlight = null);
    return _inFlight!;
  }
}

final class BackgroundSyncOutcome<R> {
  const BackgroundSyncOutcome({
    required this.wake,
    required this.ok,
    this.result,
    this.error,
    this.stackTrace,
  });

  final BackgroundWakeReason wake;
  final bool ok;
  final R? result;
  final Object? error;
  final StackTrace? stackTrace;
}

/// RxDart wake coalescer. `exhaustMap` ensures only one worker cycle owns the
/// durable queue; later wakes are unnecessary because the cycle reports whether
/// pending work remains and the OS/foreground loop will schedule another run.
ValueStream<BackgroundSyncOutcome<R>> createBackgroundSyncOutcomes<R>({
  required Iterable<Stream<BackgroundWakeReason>> wakeStreams,
  required BackgroundSyncRunner<R> runner,
}) {
  final streams = wakeStreams.toList(growable: false);
  if (streams.isEmpty) {
    throw ArgumentError.value(wakeStreams, 'wakeStreams', 'must not be empty');
  }
  return MergeStream<BackgroundWakeReason>(streams)
      .exhaustMap(
        (wake) => Stream<BackgroundSyncOutcome<R>>.fromFuture(
          runner.runOnce().then(
            (result) => BackgroundSyncOutcome<R>(
              wake: wake,
              ok: true,
              result: result,
            ),
          ),
        ).onErrorReturnWith(
          (error, stackTrace) => BackgroundSyncOutcome<R>(
            wake: wake,
            ok: false,
            error: error,
            stackTrace: stackTrace,
          ),
        ),
      )
      .shareValue();
}

/// Helper used by an app-owned top-level Flutter entry point.
///
/// Example:
///
/// ```dart
/// @pragma('vm:entry-point')
/// Future<void> optoSyncBackgroundMain() => runOptoSyncBackgroundTask(
///   () => createAppBackgroundRunner().runOnce(),
/// );
/// ```
///
/// Each app owns credential restoration and dependency construction. Tokens are
/// loaded inside the isolate from secure storage, never passed in scheduler
/// metadata or persisted in an opto-sync queue.
Future<void> runOptoSyncBackgroundTask(Future<Object?> Function() task) async {
  await task();
}
