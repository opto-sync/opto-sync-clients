# Background, reactive, and session-aware sync

This layer turns the durable protocol queue into a complete foreground and
background client for browsers and mobile applications.

## Invariants

1. IndexedDB or SQLite is the durable source of pending intent.
2. HTTP pull is the ordered source of server truth.
3. WebSocket, Supabase Realtime, raw TCP, push, online, and visibility events
   are wake hints. A dropped hint cannot create a permanent gap.
4. A background execution is bounded. It reopens storage, runs pull/push/pull,
   persists acknowledgements/checkpoints, and exits.
5. Tokens are resolved immediately before a request. opto-sync does not log or
   persist tokens.
6. Every browser database, leader lock, and broadcast channel is scoped to the
   authenticated session.

## TypeScript and RxJS

`@opto-sync/client` uses stable RxJS 7.8.2. RxJS already ships its own
TypeScript declarations; there is no separate `rx-typescript` npm package.
RxJS 8 remains an alpha and is not used in the production dependency graph.

```ts
import {
  OptimismLevel,
  createReactiveRecord$,
  createRemoteRefresh$,
  executeReactiveWrite,
  toRecordEnvelopes,
} from '@opto-sync/client/browser';

const remote$ = createRemoteRefresh$(realtimeHints$, ({ signal }) =>
  fetch('/api/docs/r1', { signal }).then(response => response.json()),
);

const record$ = createReactiveRecord$({
  client,
  tableName: 'docs',
  recordId: 'r1',
  sources: [
    indexedDbRecord$,
    toRecordEnvelopes(remote$, 'docs', 'r1', 'http'),
    websocketRecords$,
    supabaseRecords$,
  ],
});
```

The implementation uses:

- `switchMap` only for latest-only, abortable HTTP refreshes;
- `concatMap` for ordered asynchronous queue overlays;
- `distinctUntilChanged` with canonical JSON for UI de-duplication;
- `share` with a one-value `ReplaySubject` and
  `resetOnRefCountZero: true`, avoiding process-lifetime `shareReplay` caches.

### Explicit optimism levels

```ts
await executeReactiveWrite({
  optimism: OptimismLevel.DurableLocal,
  remoteWrite: () => api.save(row),
  queueLocal: () => client.queueMutation('docs', row.id, row),
  requestBackgroundSync: worker.requestSync,
  syncNow: () => loop.syncNow(),
});
```

| Level | Local commit | Network | Return boundary |
|---|---|---|---|
| `ServerConfirmed` | install confirmed response | direct HTTP | server response installed |
| `DurableLocal` | queue atomically | service/mobile worker | IndexedDB/SQLite commit |
| `DurableLocalAndWait` | queue atomically | immediate cycle plus worker fallback | immediate cycle completes |

An immediate failure never removes a durable mutation.

## Web service worker

The page registers its application-owned worker and attaches the wake callback:

```ts
const worker = await registerOptoSyncServiceWorker({
  scriptUrl: '/opto-sync-sw.js',
  type: 'module',
  scope: '/',
  periodicSync: { minIntervalMs: 15 * 60_000 },
});

client.setBackgroundSyncTrigger(
  createServiceWorkerSyncTrigger(worker, undefined, reportError),
);
```

The worker uses the same IndexedDB queue and normal protocol loop:

```ts
await initOptoSync();

const client = new OptoSyncClient({ databaseName });
const transport = new FetchProtocolTransport({
  baseUrl: '/api/sync/',
  headers: sessionAuthorizationHeaders(sessionProvider),
  credentials: 'include',
});

installProtocolServiceWorker({
  queue: client,
  transport,
  callbacks: authoritativeStore,
  runtime: {
    skipWaiting: true,
    claimClients: true,
    syncOnPush: true,
  },
});
```

The runtime handles `sync`, `periodicsync`, `push`, and explicit messages with
`event.waitUntil()`. Concurrent wakes share one run and preserve one follow-up
cycle. Background Sync is not available in every browser, so registration falls
back to an immediate worker message and the foreground loop keeps online and
visibility listeners.

Service workers cannot hold a reliable permanent WebSocket and browsers do not
expose raw TCP. Use WebSocket/Supabase/push messages to wake a bounded HTTP pull.

### Authentication in a worker

Service workers cannot read `localStorage`. A Supabase application that needs
closed-page sync must either:

- configure Supabase Auth with an IndexedDB-backed custom storage shared by the
  page and worker, while preserving the auth library's refresh serialization;
  or
- use secure server-managed cookies and `credentials: 'include'`.

Do not copy refresh tokens into queue rows or worker messages.

## Tabs, windows, and sessions

`CrossContextSyncCoordinator` uses a session-scoped Web Lock for one foreground
network leader and BroadcastChannel for payload-free wake hints. Every tab still
reads the same IndexedDB. Browsers without Web Locks run in cooperative mode:
duplicate requests are safe because mutation identity and exact-batch
acknowledgement are idempotent.

`createSupabaseSessionProvider` adapts `supabase.auth.getSession()` and
`onAuthStateChange`. Its auth callback performs no asynchronous Supabase calls.
`createSharedAuthSessionProvider` structurally accepts the generated
`shared-auth` identity/outcome and client token-store contracts without a
sibling-checkout dependency.

`SessionBoundSyncManager` hashes the verified provider scope into the IndexedDB
name and switches resources when the session changes. A degraded authority is
not treated as logout: cached data remains available and network access fails
retryably. Anonymous/logout closes the authenticated resource.

## Flutter and native mobile

The Dart package uses RxDart 0.28.0 for the equivalent reactive pipeline and
exports:

- `createReactiveRecordStream`;
- `createRemoteRefreshStream`;
- `executeReactiveWrite`;
- `DartIoProtocolTransport`;
- `dartIoWebSocketSyncHints`;
- `dartIoTcpSyncHints`;
- Supabase/shared-auth session providers;
- `MobileBackgroundSyncRunner`.

`clients/flutter` provides the Workmanager 0.9 bridge. The application's
top-level callback must rebuild dependencies inside the background isolate:

```dart
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, input) {
    return executeOptoSyncFlutterTask(task, input, buildBackgroundRunner);
  });
}
```

The native reference implementations are under `clients/mobile-native`:

- Kotlin `CoroutineWorker` and Java `Worker` use unique AndroidX WorkManager
  work, connected-network constraints, and exponential retry.
- Swift and Objective-C use `BGAppRefreshTask` plus `BGProcessingTask`,
  reschedule before running, propagate expiration cancellation, and call
  `setTaskCompleted` exactly once.

Android periodic work has a 15-minute minimum. iOS execution time and cadence
are system-controlled, not guaranteed. Register Apple task identifiers during
application launch, list them in `BGTaskSchedulerPermittedIdentifiers`, and
enable Background Fetch/Background Processing capabilities.

## Transport and storage matrix

| Runtime | Durable store | HTTP | WebSocket | TCP | Closed-app scheduler |
|---|---|---:|---:|---:|---|
| Browser tab/window | IndexedDB/Dexie | yes | hint | unavailable | service-worker wake |
| Browser service worker | IndexedDB/Dexie | yes | not persistent | unavailable | Background Sync/push/periodic |
| Flutter web | Drift SQLite on IndexedDB | yes | hint | unavailable | service worker |
| Flutter/native Dart | Drift/SQLite | yes | hint | TLS/plain hint | Workmanager |
| Android Kotlin/Java | SQLite/app store | yes | foreground hint | possible | AndroidX WorkManager |
| iOS Swift/Objective-C | SQLite/app store | yes | foreground hint | possible | BGTaskScheduler |
| Server | PostgreSQL/Supabase | protocol authority | Realtime hint | optional | process scheduler |

PostgreSQL/Supabase remain the authoritative protocol backend. SQLite and
IndexedDB are client caches/queues; the C core and Rust binding use the same
merge contract and are checked by the differential suite.
