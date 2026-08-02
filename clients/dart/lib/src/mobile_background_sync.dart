import 'dart:async';

import 'protocol_sync_loop.dart';

/// Platform-neutral scheduling contract implemented by Flutter Workmanager,
/// AndroidX WorkManager, or Apple BGTaskScheduler bridges.
abstract interface class MobileBackgroundSyncScheduler {
  Future<void> scheduleOneOff({
    required String uniqueName,
    Duration initialDelay = Duration.zero,
    bool requiresNetwork = true,
  });

  Future<void> schedulePeriodic({
    required String uniqueName,
    required Duration minimumInterval,
    bool requiresNetwork = true,
    bool requiresCharging = false,
  });

  Future<void> cancel(String uniqueName);
}

enum BackgroundSyncOutcome { success, retry, timedOut }

final class BackgroundSyncRunResult {
  final BackgroundSyncOutcome outcome;
  final int cycles;
  final int pushedMutations;
  final int acknowledgedMutations;
  final int pulledChanges;
  final String checkpoint;
  final Object? error;

  const BackgroundSyncRunResult({
    required this.outcome,
    required this.cycles,
    required this.pushedMutations,
    required this.acknowledgedMutations,
    required this.pulledChanges,
    required this.checkpoint,
    this.error,
  });
}

typedef BackgroundProtocolLoopFactory = Future<ProtocolSyncLoop> Function();

/// Runs bounded protocol cycles inside a mobile background execution window.
///
/// The factory must reopen SQLite and rebuild authentication/HTTP clients
/// inside the worker isolate/process. Capturing a foreground Drift connection
/// is unsafe because Flutter background callbacks commonly run in another
/// isolate and iOS/Android may relaunch the application from scratch.
final class MobileBackgroundSyncRunner {
  final BackgroundProtocolLoopFactory createLoop;
  final Duration deadline;
  final int maxCycles;

  const MobileBackgroundSyncRunner({
    required this.createLoop,
    this.deadline = const Duration(minutes: 8),
    this.maxCycles = 10,
  }) : assert(deadline > Duration.zero),
       assert(maxCycles > 0);

  Future<BackgroundSyncRunResult> run() async {
    final startedAt = DateTime.now();
    ProtocolSyncLoop? loop;
    var cycles = 0;
    var pushed = 0;
    var acknowledged = 0;
    var pulled = 0;
    var checkpoint = '0';
    try {
      final creating = createLoop();
      final activeLoop = await creating.timeout(
        deadline,
        onTimeout: () {
          // Dart Futures are not cancellable. If initialization eventually
          // finishes after the OS window closes, stop that late loop so it
          // cannot retain SQLite or network resources.
          unawaited(
            creating.then(
              (lateLoop) => lateLoop.stop(),
              onError: (Object _, StackTrace _) {},
            ),
          );
          throw TimeoutException(
            'mobile background sync initialization exceeded $deadline',
            deadline,
          );
        },
      );
      loop = activeLoop;
      checkpoint = await activeLoop.queue.pullCheckpoint();
      while (cycles < maxCycles) {
        final remaining = deadline - DateTime.now().difference(startedAt);
        if (remaining <= Duration.zero) {
          activeLoop.stop();
          return BackgroundSyncRunResult(
            outcome: BackgroundSyncOutcome.timedOut,
            cycles: cycles,
            pushedMutations: pushed,
            acknowledgedMutations: acknowledged,
            pulledChanges: pulled,
            checkpoint: checkpoint,
          );
        }
        final cycle = await activeLoop.syncNow().timeout(
          remaining,
          onTimeout: () {
            activeLoop.stop();
            throw TimeoutException(
              'mobile background sync exceeded $deadline',
              deadline,
            );
          },
        );
        cycles++;
        pushed += cycle.pushedMutations;
        acknowledged += cycle.acknowledgedMutations;
        pulled += cycle.pulledChanges;
        checkpoint = cycle.checkpoint;
        if (!cycle.hasMorePending) {
          return BackgroundSyncRunResult(
            outcome: BackgroundSyncOutcome.success,
            cycles: cycles,
            pushedMutations: pushed,
            acknowledgedMutations: acknowledged,
            pulledChanges: pulled,
            checkpoint: checkpoint,
          );
        }
      }
      return BackgroundSyncRunResult(
        outcome: BackgroundSyncOutcome.retry,
        cycles: cycles,
        pushedMutations: pushed,
        acknowledgedMutations: acknowledged,
        pulledChanges: pulled,
        checkpoint: checkpoint,
      );
    } on TimeoutException catch (error) {
      return BackgroundSyncRunResult(
        outcome: BackgroundSyncOutcome.timedOut,
        cycles: cycles,
        pushedMutations: pushed,
        acknowledgedMutations: acknowledged,
        pulledChanges: pulled,
        checkpoint: checkpoint,
        error: error,
      );
    } catch (error) {
      return BackgroundSyncRunResult(
        outcome: BackgroundSyncOutcome.retry,
        cycles: cycles,
        pushedMutations: pushed,
        acknowledgedMutations: acknowledged,
        pulledChanges: pulled,
        checkpoint: checkpoint,
        error: error,
      );
    } finally {
      loop?.stop();
    }
  }
}

/// Helper for a Flutter plugin's top-level background callback.
///
/// The application callback itself must also carry `@pragma('vm:entry-point')`
/// and construct [MobileBackgroundSyncRunner] inside the background isolate.
@pragma('vm:entry-point')
Future<bool> runOptoSyncFlutterBackgroundTask(
  MobileBackgroundSyncRunner runner,
) async {
  final result = await runner.run();
  return result.outcome == BackgroundSyncOutcome.success;
}
