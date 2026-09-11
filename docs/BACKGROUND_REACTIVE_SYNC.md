# Background and reactive synchronization

This document defines how opto-sync combines local-first storage, explicit write
latency policies, live transport hints, Service Workers, mobile schedulers,
Supabase/shared-auth sessions, and the protocol-v1 queue.

## Invariants

1. **One merge engine.** C is the authoritative reconciliation implementation.
   Rust, TypeScript, Dart, and Gleam reach the same pinned source through FFI,
   N-API, or WebAssembly.
2. **One durable mutation ledger.** IndexedDB in browsers and SQLite on native
   clients hold immutable `(clientId, mutationId)` work until the server confirms
   it. A wake notification is never the durability boundary.
3. **HTTP pull is authoritative.** WebSocket, Supabase Realtime,
   BroadcastChannel, and TCP events wake synchronization but do not advance a
   checkpoint or acknowledge a mutation.
4. **Background work is bounded.** Service Workers, WorkManager, and
   BGTaskScheduler may terminate execution. Each wake performs one idempotent
   HTTP push/pull cycle and exits.
5. **Sessions are partitioned without tokens.** Durable data is keyed by stable
   provider/tenant/user identity. Live streams additionally include `session_id`
   so rotation/revocation tears down stale transports.
6. **Rendering includes pending work.** UI code renders the local view—the
   authoritative row with pending mutations replayed—not a bare server response.

## Where the pieces live

Two conforming implementations of these invariants coexist today and share
the wire contract (`/sync/ws` frame protocol v1, TCP NDJSON, Background Sync
tags):

```text
INTEGRATED (inside each client package)
clients/ts                 @opto-sync/client — rx/ (watchLocalView, optimism
                           writes), transport/ws, service-worker + register-sw,
                           cross-tab (Web Locks + BroadcastChannel), schema/
                           ingest (zod); namespaced exports for wrapper repos
clients/dart               opto_sync_client — rx.dart (RxDart), transport_ws.dart,
                           schema.dart ingest validation
clients/flutter_background opto_sync_flutter_background — WorkManager (Kotlin +
                           plain-Java worker), BGTaskScheduler (Swift + ObjC
                           shim) draining the same queue

STANDALONE ORCHESTRATION (layered over the client)
clients/reactive-ts        @opto-sync/reactive (RxJS 7.8.2)
clients/reactive-dart      opto_sync_reactive (RxDart 0.28.0)
clients/rust/tests/
  c_abi_differential.rs    safe Rust wrapper vs raw C ABI
```

Prefer the integrated surfaces for app code (one dependency, one queue, one
engine); `@opto-sync/reactive` remains the standalone composition layer for
consumers that want the orchestration without adopting the client's storage.
Consolidating the overlap into one implementation is tracked work — both
must keep conforming to the invariants above and to the shared fixture and
frame contracts in the meantime.

### TypeScript / browser

`@opto-sync/reactive` supplies:

- explicit optimism strategies;
- `createReactiveRecord$` for source fusion and cross-transport dedupe;
- `HttpProtocolTransport`;
- WebSocket and structural Supabase Realtime hint sources;
- BroadcastChannel and Web Locks coordination across tabs/windows;
- a bounded Service Worker implementation;
- a bounded Node/native JSONL TCP protocol transport.

RxJS is already written in TypeScript and publishes its own types. There is no
separate canonical `rx-typescript` runtime; inventing one would add a redundant
abstraction and an unreviewed supply-chain dependency.

### Dart / Flutter

`opto_sync_reactive` supplies:

- the same optimism/session/event contracts;
- RxDart `switchMap`, `MergeStream`, `BehaviorSubject`, and `ValueStream`
  orchestration;
- a bounded single-flight background runner;
- an app-owned Flutter background entrypoint pattern;
- Swift/Objective-C BGTaskScheduler and Kotlin/Java WorkManager reference
  adapters.

The native adapters are host-integration source templates. This repository
statically verifies their cancellation, network, unique-work, retry, completion,
and credential-safety controls. A consuming Flutter app must compile them against
its selected Flutter/Android/iOS SDK versions and supply secure credential
restoration.

## Write optimism levels

Every write declares one of three strategies rather than inheriting accidental
framework behavior.

| Strategy | Canonical identity | Visible local state | Network completion returned to caller | Offline behavior |
|---|---|---|---|---|
| Remote-acknowledged / `remote-confirmed` | `opto.consistency.remote-acknowledged.v1` | only after exact-batch ack | required; `ambiguous` if the response is lost | fails closed |
| Write-through / `local-then-remote` | `opto.consistency.write-through-local-first.v1` | atomic local row + queue immediately | typed pending/confirmed/rejected/ambiguous | local write survives |
| Queued local-first / `local-durable` | `opto.consistency.queued-local-first.v1` | atomic local row + queue immediately | not awaited (`pending`) | fully supported |

See [CONSISTENCY_MODES.md](CONSISTENCY_MODES.md) for frozen intent, exact-batch
acknowledgement, and deterministic local-plus-remote read reconciliation.

`queued-local-first` / `local-durable` is the strongest UX/offline default. `remote-acknowledged` remains
appropriate for operations that are meaningless without server authorization or
inventory allocation. Write-through is useful when the screen may update
optimistically but navigation/completion should wait for a confirmed cycle.

## Reactive read model

One UI record may be observed from:

- local IndexedDB/SQLite projection;
- HTTP snapshot/pull;
- WebSocket notification;
- Supabase Realtime Postgres Change or Broadcast;
- trusted Node/native TCP notification;
- another tab/window through BroadcastChannel;
- a foreground or background worker completion.

A complete event contains table, record id, operation, payload, revision,
session partition, authority (`local-view` or `authoritative`), and a transport-
independent dedupe key. The reducer retains the latest authoritative event and
local projection. While the local projection is pending it remains visible;
after acknowledgement the authoritative projection wins.

Modern stream lifecycle choices:

- `switchMap` cancels old-session sources;
- `concatMap` serializes asynchronous projection/rebase work;
- `exhaustMap` prevents overlapping queue owners;
- WebSocket reconnect has a finite retry count and bounded exponential delay;
- scheduler injection makes retry and coalescing deterministic in tests;
- bounded event-key retention prevents an unbounded dedupe set;
- `shareReplay({bufferSize: 1, refCount: true})` replays the latest UI state
  without leaking a socket/observer when all views unsubscribe;
- one source error is reported without reclassifying a verified user as logged
  out.

## Browser tabs, windows, and sessions

Tabs sharing one origin also share the IndexedDB queue and durable client id. The
existing client uses a per-tab HLC suffix to prevent equal timestamps while the
mutation sequence remains atomic in IndexedDB.

The reactive layer adds:

- BroadcastChannel wake metadata only—no record payloads or credentials;
- Web Locks best-effort exclusive protocol-cycle ownership;
- server-side `(clientId, mutationId)` dedupe as the correctness boundary;
- session `switchMap` teardown after `session_id` changes.

If Web Locks is unavailable, more than one tab may attempt a push. This is safe:
the protocol is at-least-once and the server ledger deduplicates. The lock is a
load/latency optimization.

## Authentication and Supabase

`SyncSessionIdentity` structurally matches shared-auth's verified identity:

- `shared_user_id`;
- `provider`, `provider_tenant`, `provider_subject`;
- optional Supabase compatibility fields;
- optional `session_id`, roles, and authority.

The type deliberately excludes tokens. Header providers load current credentials
at request time. Mobile workers restore tokens from platform secure storage
inside the isolate/process. WebSocket/Supabase channel factories receive the
verified identity but remain responsible for refreshing credentials.

A shared-auth `degraded` outcome is not anonymous. Privileged synchronization
fails closed while cached/local content remains available to the application.

## Service Worker

`installOptoSyncServiceWorker` handles:

- `sync`;
- `periodicsync` where supported;
- explicit page `message` fallback;
- optional activation wake.

Concurrent events share one promise and one abort deadline. The cycle reads the
durable IndexedDB queue/checkpoint, uses HTTP, commits results, and returns.

`registerOptoSyncBackgroundWake` prefers Background Sync and falls back to a
message when the API is unavailable *or tag registration rejects*. The
canonical one-shot tag is `opto-sync`; `opto-sync:background` remains accepted
as a migration alias for registrations persisted by the first reactive
release. Worker replies expose only `SYNC_FAILED`, never raw exception text that
could contain a URL, credential, tenant identifier, or payload fragment. The
real Chromium test opens two tabs, registers one worker, sends concurrent wakes,
dispatches a genuine legacy-tag Background Sync event, forces Chrome to stop the
worker, and verifies the freshly evaluated worker resumes the IndexedDB counter.

Service Worker lifetimes are intentionally not modeled as permanent processes.
See the W3C Service Workers specification and Chrome's Workbox Background Sync
documentation for the event-driven execution model.

## Mobile background work

The Flutter headless dispatcher and Dart background runner use the same
formally specified lifecycle as the desktop runner. Native `runDrain` calls for
the same callback join one visible cycle; a callback handle cannot be replaced
while that cycle owns the permit. Wake, acquire, run, cancellation, release,
close, and process-abort transitions are specified in
`formal/mobile_desktop_lifecycle.qnt`, exhaustively checked by TLC, and
enumerated again against the production Dart transition function.

The machine controls isolate-local ownership. Cross-process correctness still
depends on the durable protocol queue, immutable mutation identity, SQLite
transactions, and server deduplication; the model does not claim to prevent an
operating system from killing a process.

### Android

- Kotlin uses `CoroutineWorker` and `withTimeout`.
- Java uses `ListenableWorker` and `CallbackToFutureAdapter`.
- Both enqueue unique work with `ExistingWorkPolicy.KEEP`.
- Both require a connected network and bound retry attempts.
- `onStopped`/cancellation propagates ownership loss and destroys the headless
  Flutter engine.

### Apple platforms

- Swift and Objective-C register refresh and processing identifiers once during
  application launch.
- Periodic catch-up uses `BGAppRefreshTask`; queue-commit wakes use a
  network-bound `BGProcessingTask` with no external-power requirement.
- Expiration reports failure, preserves queue rows, and tears down the Flutter
  engine exactly once.
- Scheduling is discretionary. Foreground/app-launch sync remains mandatory.

### Flutter isolate

The app owns a top-level `@pragma('vm:entry-point')` function. It initializes
Flutter bindings, restores verified auth through secure storage/shared-auth or
Supabase, constructs the ordinary opto-sync protocol loop, and exposes `runOnce`
over the private method channel.

Do not put bearer/refresh/service-role credentials, mutation payloads, or user
PII in scheduler input data, task identifiers, notifications, or logs.

## Storage and transport support

| Environment | Local store | Authoritative backend | Normal transport | Live hint | Background transport |
|---|---|---|---|---|---|
| Browser | IndexedDB / Dexie or Drift SQLite-on-IDB | Postgres/Supabase/server | HTTP | WebSocket, Supabase Realtime, BroadcastChannel | Service Worker HTTP |
| Flutter/native | SQLite / Drift | Postgres/Supabase/server | HTTP | WebSocket or Supabase Realtime in foreground | WorkManager/BGTask HTTP |
| Trusted Node/native service | SQLite/custom | Postgres/server | HTTP or bounded TCP JSONL | WebSocket/TCP | host scheduler |

Browsers and mobile apps do not connect directly to Postgres. Supabase access is
through authenticated HTTP/PostgREST/RPC and Realtime channels. Direct raw TCP is
reserved for trusted native/server environments.

## Deep verification

The branch-specific workflow runs:

1. RxJS package lock, typecheck, unit tests, HTTP/TCP tests, finite virtual-time
   reconnect/coalescing, listener/socket teardown, and the browser bundle budget;
2. real Chromium/two-tab Service Worker + IndexedDB, including browser-owned
   legacy sync dispatch and forced worker termination/restart;
3. RxDart analysis and behavioral self-test;
4. static host-adapter safety checks for Flutter, Swift, Objective-C, Kotlin,
   and Java;
5. 750 deterministic randomized documents plus edge cases comparing the safe
   Rust API byte-for-byte with the raw C ABI;
6. the existing Postgres-backed HTTP protocol profile;
7. the existing Supabase/PostgREST profile.

The C/Rust differential test is intentionally an ABI/wrapper parity test: the
Rust binding must translate every option and output byte exactly to the C core.
It does not claim a second independent Rust merge algorithm.

The TypeScript pilot measurement bundles the browser hint entry points as
minified ESM, enforces 65,000 raw and 20,000 gzip byte ceilings, and reports 20
module-evaluation samples. Transition instrumentation is explicit and
payload-free; WebSocket close reason text is intentionally discarded.

## Primary references

- RxJS API: <https://rxjs.dev/api>
- RxDart: <https://pub.dev/packages/rxdart>
- W3C Service Workers: <https://www.w3.org/TR/service-workers/>
- Chrome Workbox Background Sync: <https://developer.chrome.com/docs/workbox/modules/workbox-background-sync>
- Flutter background processes: <https://docs.flutter.dev/packages-and-plugins/background-processes>
- Android WorkManager: <https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started>
- Apple BackgroundTasks: <https://developer.apple.com/documentation/backgroundtasks>
- Supabase Realtime Postgres Changes: <https://supabase.com/docs/guides/realtime/postgres-changes>
- Supabase sessions: <https://supabase.com/docs/guides/auth/sessions>
