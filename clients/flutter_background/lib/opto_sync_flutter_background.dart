/// Background mutation-queue draining for opto-sync Flutter apps.
///
/// The plugin owns SCHEDULING only; the drain itself is your Dart callback
/// running the ordinary opto-sync client + sync loop against the same local
/// SQLite database the foreground app uses. Pushes are idempotent via
/// (clientId, mutationId), so a foreground/background overlap is safe.
///
/// ```dart
/// @pragma('vm:entry-point')
/// Future<bool> backgroundDrain() async {
///   final client = await openMyOptoSyncClient();       // same DB path as the app
///   final loop = ProtocolSyncLoop(queue: client, transport: myTransport,
///       callbacks: myCallbacks);
///   final result = await loop.syncNow();
///   return !result.hasMorePending;
/// }
///
/// Future<void> main() async {
///   WidgetsFlutterBinding.ensureInitialized();
///   await OptoSyncBackground.initialize(backgroundDrain);
///   await OptoSyncBackground.registerPeriodic(
///     frequency: const Duration(hours: 1),
///   );
///   // Evented wake-up: schedule an expedited drain on every durable commit.
///   client.setBackgroundSyncTrigger(OptoSyncBackground.scheduleExpedited);
/// }
/// ```
library;

import 'dart:async';
import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// The registered drain returns true when the queue is fully drained; false
/// asks the OS to reschedule sooner (Android: Result.retry with backoff).
typedef BackgroundDrain = Future<bool> Function();

class OptoSyncBackground {
  /// WorkManager's cross-version periodic-work floor. The same floor is
  /// applied before crossing the platform channel so Android and iOS callers
  /// do not observe different behavior for an impossible cadence.
  static const Duration minimumPeriodicFrequency = Duration(minutes: 15);

  static const MethodChannel _channel = MethodChannel(
    'dev.optosync.background/methods',
  );

  /// Overridable for tests.
  @visibleForTesting
  static MethodChannel channel = _channel;

  /// Registers [drain] (a top-level or static function annotated with
  /// `@pragma('vm:entry-point')`) as the background entry point.
  static Future<void> initialize(BackgroundDrain drain) async {
    final handle = PluginUtilities.getCallbackHandle(drain);
    if (handle == null) {
      throw ArgumentError(
        'drain must be a top-level or static function annotated with '
        "@pragma('vm:entry-point')",
      );
    }
    final dispatcher = PluginUtilities.getCallbackHandle(
      setupBackgroundChannel,
    );
    if (dispatcher == null) {
      throw StateError('opto-sync background dispatcher is not an entry point');
    }
    await channel.invokeMethod<void>('initialize', {
      'callbackHandle': handle.toRawHandle(),
      'dispatcherHandle': dispatcher.toRawHandle(),
    });
  }

  /// Schedules the recurring catch-up drain.
  ///
  /// Android: WorkManager PeriodicWorkRequest with a network constraint and
  /// exponential backoff. iOS: BGAppRefreshTask — [frequency] is a hint via
  /// earliestBeginDate; iOS decides the real cadence.
  static Future<void> registerPeriodic({
    Duration frequency = const Duration(hours: 1),
    bool requiresNetwork = true,
  }) async {
    if (frequency < minimumPeriodicFrequency) {
      throw RangeError.value(
        frequency,
        'frequency',
        'must be at least $minimumPeriodicFrequency',
      );
    }
    await channel.invokeMethod<void>('registerPeriodic', {
      'frequencySeconds': frequency.inSeconds,
      'requiresNetwork': requiresNetwork,
    });
  }

  /// Schedules a one-shot drain as soon as the OS allows (Android expedited
  /// work; iOS submits a network-bound processing request). Wire this to
  /// `OptoSyncClient.setBackgroundSyncTrigger` for evented push-on-commit.
  static Future<void> scheduleExpedited() async {
    try {
      await channel.invokeMethod<void>('scheduleExpedited');
    } on Exception {
      // A scheduling failure must never fail the durable local write; the
      // periodic drain (or next foreground session) still delivers. This also
      // covers MissingPluginException on an unsupported desktop/test host.
    }
  }

  /// Cancels all scheduled background drains.
  static Future<void> cancelAll() => channel.invokeMethod<void>('cancelAll');

  /// Entry point invoked by the native side inside the background engine.
  /// Not for application use.
  @pragma('vm:entry-point')
  static Future<void> setupBackgroundChannel() async {
    WidgetsFlutterBinding.ensureInitialized();
    const backgroundChannel = MethodChannel(
      'dev.optosync.background/background',
    );
    backgroundChannel.setMethodCallHandler((call) async {
      if (call.method != 'runDrain') return null;
      final arguments = call.arguments;
      if (arguments is! Map) {
        throw ArgumentError.value(arguments, 'arguments', 'must be a map');
      }
      final rawHandle = arguments['callbackHandle'];
      if (rawHandle is! int || rawHandle <= 0) {
        throw ArgumentError.value(
          rawHandle,
          'callbackHandle',
          'must be a positive integer',
        );
      }
      final handle = CallbackHandle.fromRawHandle(rawHandle);
      final callback = PluginUtilities.getCallbackFromHandle(handle);
      if (callback is! BackgroundDrain) {
        throw StateError('registered callback is not a BackgroundDrain');
      }
      return callback();
    });
    await backgroundChannel.invokeMethod<void>('backgroundChannelReady');
  }
}
