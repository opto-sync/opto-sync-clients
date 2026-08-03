# opto_sync_flutter_background

Drains the opto-sync mutation queue while the app is backgrounded or
terminated. The plugin owns **scheduling only** — the drain is your Dart
callback running the ordinary `opto_sync_client` + `ProtocolSyncLoop` against
the same SQLite database the foreground app uses. Overlap with a foreground
sync is safe: pushes dedupe on `(clientId, mutationId)`.

| Platform | Mechanism | Notes |
|---|---|---|
| Android | WorkManager (`androidx.work` 2.10.5) | periodic (≥15 min floor) + expedited one-shot on queue commit; network constraint; exponential backoff; at most five consecutive attempts per failed run |
| iOS 13+ | BGTaskScheduler | periodic `BGAppRefreshTask` (cadence is an OS hint) + network-bound `BGProcessingTask` on queue commit; refresh reschedules itself first and both tear down safely on expiration |

WorkManager 2.10.5 is intentional: it is the newest stable line that preserves
this plugin's Android API 21 minimum. WorkManager 2.11 raises its own minimum to
API 23. The plugin compiles against API 35 with Android Gradle Plugin 8.6, as
required by the 2.10 line; this does not raise its runtime API 21 minimum. A
future min-SDK bump must therefore be an explicit versioned decision.

## Flutter setup

```dart
@pragma('vm:entry-point')
Future<bool> backgroundDrain() async {
  final client = await openMyClient();          // same DB path as the app
  final loop = ProtocolSyncLoop(queue: client, transport: transport, callbacks: callbacks);
  final result = await loop.syncNow();
  return !result.hasMorePending;                // false ⇒ OS retries sooner
}

await OptoSyncBackground.initialize(backgroundDrain);
await OptoSyncBackground.registerPeriodic(frequency: const Duration(hours: 1));
client.setBackgroundSyncTrigger(OptoSyncBackground.scheduleExpedited); // evented push-on-commit
```

## iOS host app

`Info.plist`:

```xml
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
  <string>dev.optosync.background.refresh</string>
  <string>dev.optosync.background.processing</string>
</array>
<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>processing</string>
</array>
```

Register at launch, **before** `didFinishLaunchingWithOptions` returns:

```swift
// Swift
OptoSyncBackgroundPlugin.registerTasks()
```

```objc
// Objective-C
#import <opto_sync_flutter_background/OptoSyncBackgroundBridge.h>
[OptoSyncBackgroundBridge registerTasks];
```

The registration hook is process-idempotent, so overlapping host integration
paths cannot register either task identifier twice.

## Android host app

Kotlin hosts need nothing beyond the plugin (WorkManager is initialized by
androidx startup). Java-only hosts that schedule work themselves can enqueue
`dev.optosync.background.OptoSyncWorkerJava` — the same drain, plain-Java
`ListenableWorker`:

```java
WorkManager.getInstance(context).enqueueUniquePeriodicWork(
    "opto-sync-periodic",
    ExistingPeriodicWorkPolicy.UPDATE,
    new PeriodicWorkRequest.Builder(OptoSyncWorkerJava.class, 1, TimeUnit.HOURS)
        .setConstraints(new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,
            WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
        .build());
```

## Native build gate

The Kotlin, Java, Swift, and Objective-C sources here are compiled in CI by
[`.github/workflows/mobile-native-build.yml`](../../.github/workflows/mobile-native-build.yml),
which builds a throwaway Flutter host app that depends on this plugin by path.
No device, emulator, simulator, or signing identity is involved. Reproduce
locally with a JDK 17 plus Android SDK, or with Xcode:

```sh
python3 scripts/build-mobile-native.py android
python3 scripts/build-mobile-native.py ios
```

## Semantics

- The drain returning `false` (or throwing) maps to `Result.retry` (Android)
  or `success: false` (iOS). Android stops retrying a persistently failing
  run after five consecutive attempts; the next periodic interval or a later
  durable commit can wake the queue again.
- `scheduleExpedited` never throws into your write path: a scheduling failure
  or unsupported host degrades to the periodic drain / next foreground session.
- Android emits fixed `OptoSyncBackground` scheduler/worker lifecycle events
  for host and CI diagnostics. Callback exception messages, details, queue
  contents, credentials, and record data are never logged.
- Android headless workers initialize the same injected `FlutterLoader` used
  by their `FlutterEngine`, so the engine cannot observe a divergent loader.
- iOS schedules the *next* refresh before running the drain, so a crash
  mid-drain cannot break the chain.
- `cancelAll` is package-scoped: it removes only the two Opto Sync task
  identifiers on iOS and the two unique Opto Sync work names on Android.
- Android callback handles are committed to disk before `initialize` returns,
  so a process death cannot leave a scheduled worker without its Dart entrypoint.
