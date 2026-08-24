# `opto_sync_reactive`

RxDart orchestration and bounded Flutter/mobile background execution for
`opto_sync_client`.

The pure-Dart library is intentionally independent of a Flutter SDK. Reference
host adapters live under `native/` for:

- Flutter background isolate entrypoint;
- Swift and Objective-C `BGProcessingTask` integration;
- Kotlin `CoroutineWorker`;
- Java `ListenableWorker`.

Host applications copy/adapt those files and provide the platform dependencies
(`BackgroundTasks`, Flutter embedding, WorkManager, AndroidX futures).

## Authenticated lifecycle

`AuthenticatedSessionLifecycle` connects a successful Flutter/Dart login to one
foreground sync and serializes logout as durable sync, ORES OTEL force-flush,
then credential clearing. The application supplies all three callbacks and must
fence new session-scoped mutations before requesting logout. Pending mutations
remain durable whenever the receipt lacks an exact acknowledgement, committed
checkpoint, or admission fence.

## Reactive record projection

`ReactiveRecordController` uses:

- RxDart `switchMap` for auth/session replacement;
- `MergeStream` for local, HTTP, WebSocket, TCP, and Supabase streams;
- `BehaviorSubject` / `ValueStream` for the latest UI projection;
- bounded cross-transport event dedupe;
- an async projector so applications can call the same local-view/rebase logic
  used by the core Dart client.

Call `dispose()` from the owning BLoC/provider. Streams are not process-global.

## Background execution

`BackgroundSyncRunner` is single-flight and bounded. It receives a budget and
runs one durable HTTP push/pull cycle. The mobile OS may suspend or kill the
process at any moment, so correctness still comes from:

- SQLite/IndexedDB queue durability;
- immutable `(clientId, mutationId)` pushes;
- idempotent pull application;
- checkpoint persistence after application;
- no acknowledgement on timeout/expiration.

Foreground mode may keep a WebSocket/Supabase Realtime channel and call `hint()`.
Background mode does not promise a long-lived socket; WorkManager and
BGTaskScheduler wake a bounded HTTP cycle and then the Flutter engine is torn
down.

## Flutter composition root

Copy `native/flutter/opto_sync_background_entry.dart` into the host application
and replace `createAppBackgroundRunner`. The app restores a Supabase/shared-auth
session from secure storage inside the isolate, creates the normal protocol
client/transport, and supplies `runner.runOnce()`.

Never put access tokens, refresh tokens, service-role credentials, mutation
payloads, or personally identifying data in WorkManager input data, BGTask
identifiers, notifications, or scheduler logs.

## Platform behavior

### iOS / macOS-style Apple background scheduling

Register each identifier once before application launch completes. A
`BGProcessingTask` requests network connectivity, installs an expiration
handler, invokes the Flutter entrypoint, reports completion exactly once, and
destroys the engine.

Scheduling is discretionary. The implementation must still synchronize on app
launch/foreground/network restoration.

### Android

Both adapters enqueue **unique** work with `ExistingWorkPolicy.KEEP`, require a
connected network, bound retries, and call `cancel` when WorkManager stops the
worker. Kotlin uses `CoroutineWorker`; Java uses `ListenableWorker` plus
`CallbackToFutureAdapter`.

## Verification

```sh
dart pub get
dart analyze
dart run tool/self_test.dart
python3 tool/check_native_background_adapters.py
```

The self-test covers RxDart source fusion, cross-session rejection, explicit
optimism strategies, and background single-flight behavior. The native contract
checker prevents removal of expiration/cancellation, unique-work, connectivity,
retry-bound, and credential-safety controls.
