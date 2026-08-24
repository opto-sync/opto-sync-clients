# `@opto-sync/reactive`

RxJS orchestration for the existing `@opto-sync/client` protocol queue. The
package does not replace the C/WASM merge engine or invent a second queue. It
combines complete local projections and remote events, declares write latency
semantics explicitly, and wakes the same idempotent HTTP push/pull loop from
foreground, cross-tab, WebSocket, Supabase, TCP, and Service Worker signals.

## Why RxJS 7.8, not `rxts` or a prerelease

RxJS already ships first-class TypeScript types; there is no separate canonical
`rx-typescript` runtime to add. This package pins RxJS 7.8.2, the production
`latest` release when the 2026-08 pilot was reviewed. RxJS 9 is still on the
prerelease `next` channel. The unrelated npm package named `rxts` is a
single-maintainer 0.x artifact last released in January 2023 and is not part of
this architecture.

The stream lifecycle follows modern Rx practice:

- `switchMap` cancels old WebSocket/Supabase sources when `session_id` changes;
- `concatMap` serializes asynchronous projection/rebase work;
- `exhaustMap` gives one sync cycle ownership of the durable queue;
- `shareReplay({bufferSize: 1, refCount: true})` replays UI state without pinning
  sockets and IDB observers after the last subscriber leaves;
- errors from an individual hint source are diagnostics, not a false logout.

WebSocket reconnect is bounded to eight retries by default. Callers can lower
that count and inject an RxJS scheduler for deterministic backoff tests. Server
close reasons are not propagated because they can contain tenant, payload, or
credential-derived text; diagnostics expose only the bounded close code.

`DesktopSyncRunner` accepts `onLifecycleTransition` for explicit, payload-free
state telemetry. Observer failures are isolated from the ownership machine.

## Pilot evidence and budget

`npm run measure:pilot` bundles the browser hint boundary with the same minified
ESM configuration on every run, checks 65,000 raw / 20,000 gzip byte ceilings,
and measures 20 module-evaluation samples. The initial 2026-08-23 Apple Silicon
run on Node 22.13.0 produced 29,336 raw bytes, 9,487 gzip bytes, 0.841 ms median
startup, and 1.189 ms p95. CI runs the same command on the supported Node 22.16
runtime and is the comparable review boundary; startup values are evidence, not
a flaky wall-clock gate.

The unit suite uses `VirtualTimeScheduler` to prove coalescing and finite
exponential reconnect without sleeping. It also proves that final unsubscribe
closes every socket, removes every listener, leaves no scheduled retry, and
cannot leak a WebSocket close reason into diagnostics.

## Explicit optimism levels

```ts
await writeWithOptimism({
  strategy: SYNC_OPTIMISM.localThenRemote,
  session,
  value: todo,
  local: {
    commitLocalAndQueue: (value) => appDb.transaction(
      'rw',
      appDb.todos,
      client.db.localMutations,
      client.db.meta,
      () => client.queueMutationAtomic(
        'todos',
        value.id,
        value,
        [appDb.todos],
        (stamped) => appDb.todos.put(stamped),
      ),
    ),
    commitAuthoritative: (value) => appDb.todos.put(value),
  },
  remote: { write: (value, signal) => api.putTodo(value, signal) },
  sync: protocolLoop,
  wakeBackground: () => registerOptoSyncBackgroundWake(registration),
});
```

- `remote-confirmed`: send first; mutate local authoritative state only after a
  successful response.
- `local-durable`: atomically update local storage and queue, then return. A
  Service Worker/mobile worker lands it later.
- `local-then-remote`: update local state immediately, but keep the caller's
  completion boundary open until one protocol cycle finishes.

## Local + HTTP + WebSocket + TCP + Supabase

`createReactiveRecord$` consumes complete `local-view` projections and
`authoritative` events from any number of sources. Cross-transport dedupe ignores
the delivery mechanism, so one Postgres change seen through HTTP pull,
Supabase Realtime, and a WebSocket does not render three times.

WebSocket, Supabase Realtime, BroadcastChannel, and TCP notifications are wake
hints. They never advance a checkpoint or acknowledge a mutation. HTTP protocol
v1 remains the commit-ordered source of truth.

`TcpJsonLineProtocolTransport` is intentionally exported only through
`@opto-sync/reactive/node-tcp`. Raw TCP is suitable for trusted Node/native
processes; it is not a browser or suspended-mobile transport.

## Cross-tab and session isolation

A storage partition is based on provider + provider tenant + stable shared user
id, so token refresh does not strand queued work. A transport generation also
includes `session_id`; `switchMap` closes old sockets after session rotation or
revocation.

`createBroadcastHintBus` broadcasts only wake metadata, never payloads or auth.
`runWithBrowserSyncLock` uses Web Locks when available so two tabs do not flush
one IndexedDB queue simultaneously. The server still dedupes by
`(clientId, mutationId)`; browser locking is an efficiency control, not the
correctness boundary.

## Service Worker

```ts
installOptoSyncServiceWorker({
  scope: self,
  syncOnce: (signal) => protocolLoop.syncNow(),
});
```

A Service Worker is event-driven and may be killed after any event. The callback
must run one bounded HTTP push/pull cycle from the durable queue/checkpoint and
return. It must not rely on a permanent WebSocket, memory-only retry state, or an
uncommitted acknowledgement.

`registerOptoSyncBackgroundWake` prefers the browser Background Sync API and
falls back to a worker message both when the API is absent and when tag
registration fails (for example because of browser quota or permission state).
The canonical tag is `opto-sync`; workers also accept the early
`opto-sync:background` tag so already-durable registrations survive an upgrade.
Message failure replies use the bounded `SYNC_FAILED` classification and never
echo transport/storage exception text. The Chromium test opens two tabs on one
real origin, fires concurrent wakes, dispatches the legacy Background Sync tag
through Chrome's service-worker protocol, forcibly terminates the worker, and
proves a fresh worker resumes the durable IndexedDB cycle counter. Set
`OPTO_SYNC_CHROMIUM_PATH` when Chromium exists outside Playwright's cache.

## Authentication

`SyncSessionIdentity` is structurally compatible with the generated shared-auth
identity contract and Supabase compatibility aliases. It deliberately excludes
access/refresh tokens. Applications restore credentials in their transport
header callback or secure worker composition root.

`degraded` is not treated as anonymous: privileged synchronization fails closed
until either shared-auth or Supabase can verify the session.
