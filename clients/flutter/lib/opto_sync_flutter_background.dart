import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:workmanager/workmanager.dart';

const String optoSyncOneOffTask = 'opto-sync.flush';
const String optoSyncPeriodicTask = 'opto-sync.periodic';

/// Workmanager 0.9 bridge for Android WorkManager and Apple background tasks.
final class WorkmanagerBackgroundSyncScheduler
    implements MobileBackgroundSyncScheduler {
  final Workmanager workmanager;
  final String taskName;

  WorkmanagerBackgroundSyncScheduler({
    Workmanager? workmanager,
    this.taskName = optoSyncOneOffTask,
  }) : workmanager = workmanager ?? Workmanager();

  /// Call once during foreground application startup.
  Future<void> initialize(Function callbackDispatcher) =>
      workmanager.initialize(callbackDispatcher);

  @override
  Future<void> scheduleOneOff({
    required String uniqueName,
    Duration initialDelay = Duration.zero,
    bool requiresNetwork = true,
  }) {
    return workmanager.registerOneOffTask(
      uniqueName,
      taskName,
      initialDelay: initialDelay,
      constraints: Constraints(
        networkType: requiresNetwork
            ? NetworkType.connected
            : NetworkType.notRequired,
      ),
      // Maps to APPEND_OR_REPLACE in current AndroidX WorkManager. A mutation
      // queued during a running tail gets a follow-up without cancelling the
      // idempotent in-flight request.
      existingWorkPolicy: ExistingWorkPolicy.update,
      backoffPolicy: BackoffPolicy.exponential,
      backoffPolicyDelay: const Duration(seconds: 10),
      tag: optoSyncOneOffTask,
    );
  }

  @override
  Future<void> schedulePeriodic({
    required String uniqueName,
    required Duration minimumInterval,
    bool requiresNetwork = true,
    bool requiresCharging = false,
  }) {
    if (minimumInterval < const Duration(minutes: 15)) {
      throw ArgumentError.value(
        minimumInterval,
        'minimumInterval',
        'WorkManager periodic work cannot run more often than every 15 minutes',
      );
    }
    return workmanager.registerPeriodicTask(
      uniqueName,
      optoSyncPeriodicTask,
      frequency: minimumInterval,
      constraints: Constraints(
        networkType: requiresNetwork
            ? NetworkType.connected
            : NetworkType.notRequired,
        requiresCharging: requiresCharging,
      ),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
      backoffPolicy: BackoffPolicy.exponential,
      backoffPolicyDelay: const Duration(seconds: 10),
      tag: optoSyncPeriodicTask,
    );
  }

  @override
  Future<void> cancel(String uniqueName) =>
      workmanager.cancelByUniqueName(uniqueName);
}

typedef FlutterBackgroundRunnerFactory =
    Future<MobileBackgroundSyncRunner> Function(
      String taskName,
      Map<String, dynamic>? inputData,
    );

/// Body for the application's top-level Workmanager callback dispatcher.
///
/// The application remains responsible for a top-level
/// `@pragma('vm:entry-point')` dispatcher because only it knows how to reopen
/// the session-scoped SQLite database and restore auth in a fresh isolate:
///
/// ```dart
/// @pragma('vm:entry-point')
/// void callbackDispatcher() {
///   Workmanager().executeTask((task, input) {
///     return executeOptoSyncFlutterTask(task, input, buildRunner);
///   });
/// }
/// ```
Future<bool> executeOptoSyncFlutterTask(
  String taskName,
  Map<String, dynamic>? inputData,
  FlutterBackgroundRunnerFactory createRunner,
) async {
  if (taskName != optoSyncOneOffTask &&
      taskName != optoSyncPeriodicTask &&
      taskName != Workmanager.iOSBackgroundTask) {
    return true;
  }
  final runner = await createRunner(taskName, inputData);
  return runOptoSyncFlutterBackgroundTask(runner);
}
