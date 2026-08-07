import 'dart:async';

import 'package:rxdart/rxdart.dart';

enum BackgroundWakeReason {
  localMutation,
  remoteHint,
  connectivity,
  operatingSystem,
  manual,
}

final class BackgroundSyncContext {
  BackgroundSyncContext(this.budget) : deadline = DateTime.now().add(budget);

  final Duration budget;
  final DateTime deadline;
  Object? _cancellationReason;

  bool get isCancelled => _cancellationReason != null;
  Object? get cancellationReason => _cancellationReason;

  Duration get remaining {
    final value = deadline.difference(DateTime.now());
    return value.isNegative ? Duration.zero : value;
  }

  void cancel([Object reason = 'opto-sync background cycle cancelled']) {
    _cancellationReason ??= reason;
  }

  void throwIfCancelled() {
    final reason = _cancellationReason;
    if (reason != null) {
      throw StateError('opto-sync background cycle cancelled: $reason');
    }
  }
}

typedef BackgroundSyncCycle<R> =
    Future<R> Function(BackgroundSyncContext context);

/// One bounded, single-flight HTTP push/pull cycle for a worker isolate.
///
/// Android WorkManager and Apple BGTaskScheduler may stop a task at any time.
/// The callback must therefore use durable queue/checkpoint state, remain
/// idempotent, observe [BackgroundSyncContext], and finish within its budget. It
/// must not own a permanent socket.
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
  Future<R>? _operation;
  Future<R>? _visibleResult;
  BackgroundSyncContext? _context;

  Future<R> runOnce() {
    final visible = _visibleResult;
    if (visible != null) return visible;

    final context = BackgroundSyncContext(budget);
    // Future.sync converts setup-time exceptions (credential restoration,
    // database opening, dependency construction) into the same asynchronous
    // failure channel as later protocol errors. This ensures every caller sees
    // one shared Future and the runner can clear ownership consistently.
    final operation = Future<R>.sync(() => _syncOnce(context));
    final bounded = operation.timeout(
      budget,
      onTimeout: () {
        context.cancel('deadline exceeded');
        throw TimeoutException(
          'opto-sync background cycle exceeded $budget',
          budget,
        );
      },
    );
    _context = context;
    _operation = operation;
    _visibleResult = bounded;

    // Future.timeout cannot cancel arbitrary Dart work. Keep the timed-out
    // result installed until the underlying callback actually settles so a
    // second OS/foreground wake cannot overlap a non-cooperative first cycle.
    operation.then<void>(
      (_) => _clearIfCurrent(operation),
      onError: (_error, _stackTrace) => _clearIfCurrent(operation),
    );
    return bounded;
  }

  void cancel([Object reason = 'native scheduler stopped the worker']) {
    _context?.cancel(reason);
  }

  void _clearIfCurrent(Future<R> operation) {
    if (!identical(_operation, operation)) return;
    _context = null;
    _operation = null;
    _visibleResult = null;
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

/// Coalesce wake bursts and serialize durable queue ownership.
///
/// A single-concurrency flat-map preserves one coalesced trailing wake that
/// arrives while a cycle is running. Dropping it would strand a mutation
/// committed just after the active cycle inspected its queue. The runner still
/// guarantees single-flight.
ValueStream<BackgroundSyncOutcome<R>> createBackgroundSyncOutcomes<R>({
  required Iterable<Stream<BackgroundWakeReason>> wakeStreams,
  required BackgroundSyncRunner<R> runner,
  Duration coalesce = const Duration(milliseconds: 25),
}) {
  final streams = wakeStreams.toList(growable: false);
  if (streams.isEmpty) {
    throw ArgumentError.value(wakeStreams, 'wakeStreams', 'must not be empty');
  }
  if (coalesce.isNegative) {
    throw ArgumentError.value(coalesce, 'coalesce', 'must not be negative');
  }
  return MergeStream<BackgroundWakeReason>(streams)
      .debounceTime(coalesce)
      .flatMap<BackgroundSyncOutcome<R>>(
        (BackgroundWakeReason wake) =>
            Stream<BackgroundSyncOutcome<R>>.fromFuture(
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
        maxConcurrent: 1,
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
