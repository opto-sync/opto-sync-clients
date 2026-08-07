# Native mobile background workers

These are reference host bridges for applications that do not schedule through
the Flutter Workmanager adapter.

The delegate supplied by the application must:

1. resolve the current Supabase/shared-auth session without logging tokens;
2. open the session-scoped SQLite database in WAL mode;
3. run bounded pull/push/pull protocol cycles;
4. persist acknowledgements and checkpoints before reporting success;
5. honor cancellation/expiration.

## Android

Kotlin uses `CoroutineWorker`; Java uses `Worker`. Add AndroidX WorkManager
2.8 or newer (the code uses `APPEND_OR_REPLACE` and periodic `UPDATE`):

```kotlin
implementation("androidx.work:work-runtime-ktx:<current-version>")
```

Install the delegate factory from `Application.onCreate()`, not an Activity.
Android invokes `Application.onCreate()` for a cold WorkManager process.
Call `scheduleOneOff()` after every durable queue commit and keep a 15-minute
or slower periodic job as a safety net.

## iOS

Add the Swift file or Objective-C `.h/.m` pair to the application target.
Register during application launch, enable Background Fetch and Background
Processing, and list both task identifiers under
`BGTaskSchedulerPermittedIdentifiers`.

`BGAppRefreshTask` is for short catch-up. `BGProcessingTask` declares network
connectivity and is the better fit for a larger durable backlog. iOS controls
the actual start time and may expire either task; expiration is propagated to
the sync delegate and completion is reported exactly once.

For a user-initiated large upload/download, use the platform's background
`URLSession` facilities rather than holding a sync task open.
