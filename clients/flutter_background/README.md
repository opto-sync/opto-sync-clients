# opto_sync_flutter_background

Drains the opto-sync mutation queue while the app is backgrounded or
terminated. The plugin owns **scheduling only** — the drain is your Dart
callback running the ordinary `opto_sync_client` + `ProtocolSyncLoop` against
the same SQLite database the foreground app uses. Overlap with a foreground
sync is safe: pushes dedupe on `(clientId, mutationId)`.

| Platform | Mechanism | Notes |
|---|---|---|
| Android | WorkManager (`androidx.work` 2.9+) | periodic (≥15 min floor) + expedited one-shot on queue commit; network constraint; exponential backoff via `Result.retry` |
| iOS 13+ | BGTaskScheduler | `BGAppRefreshTask` (cadence is an OS hint) + `BGProcessingTask` for large drains; reschedules itself first, expiration-safe |

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
  or `success: false` (iOS) — the OS retries with backoff. Self-correcting:
  a later success resets the chain.
- `scheduleExpedited` never throws into your write path: a scheduling failure
  degrades to the periodic drain / next foreground session.
- iOS schedules the *next* refresh before running the drain, so a crash
  mid-drain cannot break the chain.
