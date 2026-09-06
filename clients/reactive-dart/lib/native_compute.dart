/// Native Android/iOS/desktop only. Keep this import out of Flutter web builds.
library;

import 'dart:async';
import 'dart:collection';
import 'dart:isolate';

enum NativeComputeFailure { queueFull, disposed, taskFailed }

final class NativeComputeException implements Exception {
  const NativeComputeException(this.code);
  final NativeComputeFailure code;
  @override
  String toString() => 'NativeComputeException(${code.name})';
}

/// Bounded CPU execution with at most [size] short-lived native isolates.
///
/// Use top-level/static functions and sendable DTOs. Do not capture a widget,
/// store, database connection, or credentials. This executor is for pure CPU
/// work; the existing sync runner owns durable writes in its own isolate.
final class NativeComputeExecutor {
  NativeComputeExecutor({this.size = 2, this.maxPending = 32}) {
    if (size < 1 || size > 4 || maxPending < size) {
      throw ArgumentError('size must be 1..4 and maxPending >= size');
    }
  }

  final int size;
  final int maxPending;
  final _queue = Queue<_ComputeJob>();
  final _running = <_ComputeJob>{};
  var _disposed = false;

  Future<O> run<I, O>(O Function(I input) compute, I input) {
    if (_disposed) {
      return Future.error(
        const NativeComputeException(NativeComputeFailure.disposed),
      );
    }
    if (_queue.length + _running.length >= maxPending) {
      return Future.error(
        const NativeComputeException(NativeComputeFailure.queueFull),
      );
    }
    final result = Completer<O>();
    final job = _ComputeJob(
      () async {
        try {
          final output = await _computeInIsolate(compute, input);
          if (!result.isCompleted) result.complete(output);
        } catch (_) {
          if (!result.isCompleted) {
            result.completeError(
              const NativeComputeException(NativeComputeFailure.taskFailed),
            );
          }
        }
      },
      () {
        if (!result.isCompleted) {
          result.completeError(
            const NativeComputeException(NativeComputeFailure.disposed),
          );
        }
      },
    );
    _queue.add(job);
    _pump();
    return result.future;
  }

  void _pump() {
    while (!_disposed && _running.length < size && _queue.isNotEmpty) {
      final job = _queue.removeFirst();
      _running.add(job);
      unawaited(
        job.execute().whenComplete(() {
          _running.remove(job);
          _pump();
        }),
      );
    }
  }

  /// Rejects queued/in-flight callers. Already-running Isolate.run computations
  /// finish and exit naturally; they cannot mutate UI or acknowledge queue data.
  /// Use a dedicated persistent isolate with explicit kill/timeout ownership for
  /// untrusted or unbounded work. This executor expects finite pure functions.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    for (final job in [..._queue, ..._running]) {
      job.cancel();
    }
    _queue.clear();
  }
}

// A top-level boundary avoids implicitly capturing the executor in the isolate.
Future<O> _computeInIsolate<I, O>(O Function(I) compute, I input) =>
    Isolate.run(() => compute(input));

final class _ComputeJob {
  _ComputeJob(this.execute, this.cancel);
  final Future<void> Function() execute;
  final void Function() cancel;
}
