# Connectivity, total-offline mode, and post-save signals

Opto-Sync exposes connectivity as data and callbacks. It does **not** render a banner, toast, snackbar, alert, status icon, or any other UI. Applications can bind the same library event to React, Flutter, Leptos, Dioxus, native mobile UI, logs, telemetry, or nothing at all.

## Contract

Every runtime uses the same four states:

| State | Meaning |
| --- | --- |
| `unknown` | No trustworthy observation has been made yet. |
| `offline` | No usable path is known, or total-offline mode is active. |
| `link` | A network path exists, but end-to-end internet/server reachability has not been verified. |
| `internet` | A bounded probe or trusted platform validator confirmed reachability. |

The mode is either `automatic` or `offline`. The explicit offline mode is authoritative:

- durable local queue writes continue;
- generic post-save events continue, carrying an offline snapshot;
- active probes and network-bound wake hints are suppressed;
- the dedicated online-save hook does not fire;
- platform observations are remembered but are not exposed until automatic mode is restored;
- restoring automatic mode immediately publishes the newest remembered state and may wake the existing sync loop if internet is verified.

Connectivity is a scheduling and presentation hint, never a durability boundary. A hook exception, rejected promise, platform-channel failure, or failed scheduling request cannot roll back a queue transaction that has already committed.

## Post-save event

The library emits only metadata after a durable local upsert or delete:

- queue/mutation identity;
- table or collection name;
- record identity;
- `upsert` or `delete`;
- save timestamp;
- immutable connectivity snapshot.

Mutation payloads, credentials, authorization headers, probe response bodies, and device identifiers are not included.

`onSave` runs after every successful durable local save. `onOnlineSave` runs only when that save observes verified `internet` state. The host application decides how to “tell the user.”

## TypeScript, browser, Node, and JavaScript hosts

Use a same-origin endpoint when the application needs verified internet/server reachability. Browser `online` and `offline` events by themselves establish only `link` or `offline`.

```ts
import {
  BrowserConnectivityWatcher,
  ConnectivityAwareOptoSyncClient,
} from '@opto-sync/client';

const connectivity = new BrowserConnectivityWatcher({
  probeUrl: '/health/reachability',
  probeMethod: 'HEAD',
  probeTimeoutMs: 4_000,
  probeIntervalMs: 30_000,
});

const client = new ConnectivityAwareOptoSyncClient({
  databaseName: 'application',
  connectivity,
  onSave(event) {
    applicationEvents.emit('opto-sync:save', event);
  },
  onOnlineSave(event) {
    // UI-agnostic: a React store, toast controller, logger, or native shell can
    // consume this event. Opto-Sync does not render anything.
    applicationEvents.emit('opto-sync:save-with-internet', event);
  },
  onMutationQueued() {
    syncLoop.wake();
  },
});

await client.queueMutation('documents', 'doc-1', { title: 'saved locally' });

client.setTotalOffline(true);
await client.queueDelete('documents', 'doc-2'); // still durable; no network wake
client.setTotalOffline(false);
```

Node, SSR, tests, Electron main processes, and other non-browser runtimes can inject a `ManualConnectivityWatcher` and publish observations from their own OS or application probe.

```ts
import {
  ManualConnectivityWatcher,
  ConnectivityAwareOptoSyncClient,
} from '@opto-sync/client';

const connectivity = new ManualConnectivityWatcher();
const client = new ConnectivityAwareOptoSyncClient({ connectivity });

connectivity.publish('link', 'platform');
connectivity.publish('internet', 'probe');
```

### React-compatible external-store binding

No React package is required by Opto-Sync. The watcher already matches the `subscribe/getSnapshot` shape used by external-store bindings:

```ts
const subscribe = (notify: () => void) =>
  client.subscribeConnectivity(() => notify(), { emitCurrent: false });

const getSnapshot = () => client.connectivitySnapshot();

// In application code:
// const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
```

The returned unsubscribe function must be used during component cleanup.

### Service workers and TypeScript-hosted WASM

The same browser watcher works in a window-like host that provides `online`/`offline` events. In service-worker environments without `navigator.onLine`, inject a manual watcher and publish results from the worker's actual request outcomes. A successful authenticated sync request is stronger evidence than a browser link hint.

## Dart without Flutter

The Dart package contains no widget dependency:

```dart
import 'package:opto_sync_client/connectivity.dart';

final watcher = ManualOptoSyncConnectivityWatcher();
final signals = OptoSyncConnectivitySaveSignals(
  watcher: watcher,
  onSave: (event) => applicationEvents.add(event),
  onOnlineSave: (event) => userNotificationEvents.add(event),
  onMutationQueued: syncLoop.wake,
);

final queueId = await signals.afterDurableSave<int>(
  save: () => client.queueMutation('documents', 'doc-1', payload),
  queueId: (value) => value,
  tableName: 'documents',
  recordId: 'doc-1',
  operation: OptoSyncSaveOperation.upsert,
);

signals.setTotalOffline(true);
```

Existing queue implementations can call `notifyAfterDurableSave` immediately after their transaction commits instead of using the wrapper.

## Flutter, Android, and iOS through one stream

The Flutter plugin bridges native Android and Apple watchers through an event channel without importing Material or Cupertino UI.

```dart
import 'package:opto_sync_flutter_background/opto_sync_flutter_background.dart';

final connectivity = OptoSyncFlutterConnectivity(
  probeUrl: Uri.parse('https://api.example.com/health/reachability'),
)..start();

final signals = OptoSyncConnectivitySaveSignals(
  watcher: connectivity,
  onSave: applicationEvents.add,
  onOnlineSave: saveNotificationEvents.add,
  onMutationQueued: OptoSyncBackground.scheduleExpedited,
);

connectivity.changes.listen((snapshot) {
  connectivityStore.value = snapshot; // any state-management library or none
});

connectivity.setTotalOffline(true);
```

On Android, the native adapter reports `internet` only when `ConnectivityManager` exposes a validated network. On Apple platforms, `NWPathMonitor` satisfaction reports `link`; the optional bounded HTTP probe promotes it to `internet` after a response is received.

The offline override is persisted natively. Android WorkManager jobs and Apple background tasks check it before starting a drain, and expedited scheduling becomes a no-op while it is enabled.

## Kotlin and Android directly

```kotlin
val watcher = OptoSyncConnectivityWatcher(applicationContext)
watcher.start()

val subscription = watcher.addListener(
    OptoSyncConnectivityListener { current, previous ->
        applicationEventBus.publish(current)
    },
    emitCurrent = true,
)

watcher.setTotalOffline(true)
watcher.setTotalOffline(false)

// Cleanup:
subscription.close()
watcher.stop()
```

A Java-only host can use `OptoSyncConnectivityWatcherJava`:

```java
OptoSyncConnectivityWatcherJava watcher =
    new OptoSyncConnectivityWatcherJava(applicationContext);
watcher.start();
AutoCloseable subscription = watcher.addListener(
    (current, previous) -> applicationEvents.publish(current),
    true);
watcher.setTotalOffline(true);
```

## Swift and Apple platforms directly

```swift
let watcher = OptoSyncConnectivityWatcher.shared
watcher.configureProbe(
  urlString: "https://api.example.com/health/reachability",
  timeoutMilliseconds: 4_000)
watcher.start()

let token = watcher.addListener { current, previous in
  applicationEvents.publish(current.dictionary)
}

watcher.setTotalOffline(true)
watcher.setTotalOffline(false)

// Cleanup:
watcher.removeListener(token)
```

The probe URL must use HTTP or HTTPS and must not contain embedded credentials. Use a narrow endpoint that returns no sensitive body.

## Objective-C directly

Objective-C hosts use the facade and notification API:

```objc
#import <opto_sync_flutter_background/OptoSyncConnectivity.h>

[OptoSyncConnectivityBridge configureProbeURLString:
    @"https://api.example.com/health/reachability"
    timeoutMilliseconds:4000];
[OptoSyncConnectivityBridge start];

id observer = [[NSNotificationCenter defaultCenter]
    addObserverForName:OptoSyncConnectivityDidChangeNotification
                object:nil
                 queue:[NSOperationQueue mainQueue]
            usingBlock:^(NSNotification *note) {
  NSDictionary *snapshot = note.userInfo;
  [applicationEvents publish:snapshot];
}];

[OptoSyncConnectivityBridge setTotalOffline:YES];
```

## Rust, native servers, desktop, and WebAssembly

The `opto-sync-connectivity` crate is framework-neutral:

```rust
use opto_sync_connectivity::{
    ConnectivityState, ConnectivityWatcher, SaveMetadata, SaveOperation,
    SaveSignals,
};
use std::time::Duration;

let watcher = ConnectivityWatcher::default();
let signals = SaveSignals::new(watcher.clone());

let _online_save = signals.on_online_save(|event| {
    application_events().publish(event);
});
signals.set_wake_hint(Some(|| sync_loop().wake()));

let _probe = watcher.spawn_probe(Duration::from_secs(15), || {
    if application_health_probe() {
        ConnectivityState::Internet
    } else if platform_has_a_path() {
        ConnectivityState::Link
    } else {
        ConnectivityState::Offline
    }
})?;

let queue_id = signals
    .after_durable_save(
        SaveMetadata::new("documents", "doc-1", SaveOperation::Upsert),
        || async { durable_queue_write().await },
        |id| id.to_string(),
    )
    .await?;
```

### Rust WebAssembly

Enable the crate's `wasm` feature:

```rust
use opto_sync_connectivity::{ConnectivityWatcher, SaveSignals};
use opto_sync_connectivity::wasm::BrowserConnectivityWatcher;

let watcher = ConnectivityWatcher::default();
let browser = BrowserConnectivityWatcher::new(watcher.clone())?;
let signals = SaveSignals::new(watcher);

// Browser events establish Link/Offline. Promote only after the application's
// actual same-origin health request succeeds.
browser.record_probe_result(health_request_succeeded);
```

### Leptos and Dioxus

Opto-Sync does not depend on either framework. Bind a watcher subscription to the framework's signal setter and retain the subscription in component-owned state:

```rust
let subscription = watcher.subscribe(true, move |next, _previous| {
    set_framework_signal(next);
});
```

In Leptos, call an `RwSignal` or write-signal setter and drop the subscription from owner cleanup. In Dioxus, update a component `Signal` and retain/drop the subscription with the component lifecycle. Native/SSR processes can run the periodic probe; hydrated browser code can retain `wasm::BrowserConnectivityWatcher`.

## Operational guidance

1. Treat `link` as “worth trying soon,” not as proof that the server is reachable.
2. Keep probes bounded, cache-free, narrow, and free of secrets.
3. Do not use connectivity listeners to decide whether a local write is allowed. Write locally first.
4. Do not mark queue records synced because connectivity changed. Only an acknowledged sync response owns that transition.
5. Keep listener/subscription handles alive for the desired lifetime, then dispose or drop them.
6. Use total-offline mode for user intent, privacy, testing, metered-network policy, or deterministic demos. It is stronger than a detector result.
7. Route save events to an application-owned event bus or state store; UI rendering remains outside this library.
