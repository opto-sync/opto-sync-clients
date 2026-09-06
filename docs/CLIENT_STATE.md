# Client state and off-main execution

Keep UI state in the framework's native reactive system. Keep reconciliation,
durability, and networking in opto-sync's existing client/runner. Reducers are
synchronous and pure; async commands report results through a dispatcher.
No React integration or React dependency is involved.

For Leptos and Dioxus, start with the native-signal dispatchers in
[`examples/state-workspace`](../examples/state-workspace). They use only their
framework and shared DTOs, with no external state crate. Leptos exposes a
`ReadSignal` through context; Dioxus exposes its native `ReadSignal` through
context. The writable signal stays private to the dispatcher. A single-session
Dioxus client can alternatively use a `GlobalSignal`, but a request/session
context is the safer default when a process might serve multiple users.

The optional `opto-sync-state` crate provides the same small store contract as
TypeScript and Dart when a host wants portable application logic or shared
behavioral tests. Its default build has zero runtime dependencies. Optional
`leptos` and `dioxus` features adapt selectors to framework signals; they do not
introduce a renderer, scheduler, persistence engine, or another queue.

## Common state contract

| Capability | TypeScript | Dart / Flutter | Rust native / WASM |
| --- | --- | --- | --- |
| Synchronous reducer | `StateStore` | `StateStore` | `StateStore` |
| Read current value | `state` | `state` | `state()` (`Rc<S>`) |
| Distinct selection + initial replay | `select` | `select` | `select` / `select_by` |
| Async result fence per key | `beginEffect` | `beginEffect` | `begin_effect` |
| Rebased projection | `projectLocalView` | `projectLocalView` | `project_local_view` |
| Clear state and invalidate effects | `reset` | `reset` | `reset` |
| Release owner | `dispose` | `dispose` | `dispose`; RAII subscription/effect cleanup |
| Native UI adapter | Any callback/signal/DOM consumer | `StoreListenable` | Native-signal examples; optional selector adapters |

The shared [`opto.state-store.v1` corpus](../conformance/state-store/scenario.json)
runs in all three languages. It covers deterministic transitions, selection
deduplication, interleaved effect keys, superseded results, reset, unsubscribe,
and disposal. This is state-layer parity, not a claim that every protocol,
database, platform, or third-party state-library feature is interchangeable.
Existing SDK capability declarations remain in [SDK_API_CONTRACT.md](SDK_API_CONTRACT.md).

State, actions, and selected values must be immutable. In TypeScript, use
readonly DTOs and immutable replacements (freeze nested DTOs in development if
needed); Dart uses immutable classes/records and unmodifiable collections; Rust
uses plain DTOs without interior mutation. Generic stores cannot prove purity
of application callbacks. A failed reducer leaves the previous state/revision
intact only when it did not mutate its input.

Each successful dispatch/reset advances the revision even for a no-op action;
selectors notify only when their equality function says the selection changed.
TypeScript defaults to `Object.is`, Dart to `==`, Rust to `PartialEq`. Supply an
appropriate comparator for lists/maps or derived objects. Keep selectors pure.
Do not dispatch, reset, subscribe, or start effects from inside a reducer or
subscriber: transitions reject reentrancy. Schedule follow-up actions outside
the notification call. Unsubscription during notification is allowed.

TypeScript/Dart isolate post-commit subscriber errors through the optional
`onObserverError` callback; initial subscription errors propagate and do not
retain a listener. Rust subscribers must not panic. Rust fallible reducers use
`try_new` and return `StoreError`; a panic is not a portable error mechanism on
WASM. The core deliberately does not retain state/action history or log DTOs.

## TypeScript, without a UI framework dependency

```ts
import { StateStore } from '@opto-sync/reactive/state';

type State = Readonly<{ title: string; busy: boolean; error: string | null }>;
type Action =
  | { type: 'loading' }
  | { type: 'hydrate'; title: string }
  | { type: 'failed' };
const initial: State = { title: '', busy: false, error: null };
const store = new StateStore<State, Action>(initial, (state, action) => {
  switch (action.type) {
    case 'loading': return { ...state, busy: true, error: null };
    case 'hydrate': return { title: action.title, busy: false, error: null };
    case 'failed': return { ...state, busy: false, error: 'Sync unavailable' };
  }
});
const stop = store.select(s => s.title, title => { titleElement.textContent = title; });
// Component cleanup: stop(). Session/application cleanup: store.dispose().
```

For RxJS, wrap `select` in `new Observable(subscriber =>
store.select(selector, value => subscriber.next(value)))`. Unsubscribe that
stream when its view is destroyed. Store disposal releases listeners; it does
not automatically complete externally created Rx subscriptions.

## Connect the existing durable queue

Hydrate **`localView`**, not raw HTTP replies or `reconcileIncoming`. Raw server
state does not know which edits are still pending. A worker that owns sync must
apply the pull and replay the durable pending queue before publishing UI data.
The integration test exercises this against the real TypeScript queue and the
native merge engine with a newer server timestamp.

The host's session composition root owns the authenticated client, app database,
protocol loop, and an effect fence. Bind every callback to that same session's
storage partition; do not let delayed callbacks look up a newly logged-in
user's global database handle.

```ts
// Create once per session; close/reset and stop upstream sources at logout.
const sessionWork = store.beginEffect('session-work');

async function saveTodo(todo: Todo) {
  if (!sessionWork.isCurrent()) return;
  // The real client's atomic transaction writes the app row and queued intent.
  await client.queueMutationAtomic('todos', todo.id, todo, [appTodos],
    stamped => appTodos.put(stamped).then(() => {}));
  protocolLoop.hint(); // wake only; this is not an acknowledgement
  if (!sessionWork.isCurrent()) return;
  await store.projectLocalView('todo:' + todo.id,
    async () => client.localView('todos', todo.id, await readAuthoritative(todo.id)),
    value => ({ type: 'hydrate', title: String(value?.title ?? '') }));
}
```

The `appTodos` table must belong to the same Dexie database/transaction as the
queue. Wire `watchLocalView` (from the existing client's Rx layer) to dispatch
the same hydrate action after pulls/acknowledgements. For Dart/Rust, inject the
equivalent existing local-view and atomic storage calls; the state layer never
reimplements merging, acknowledgement, ordering, or checkpoint persistence.

For immediate draft feedback, dispatch an ephemeral draft action synchronously.
After the local transaction commits, publish the durable projection. If the
transaction fails, show a failure and reload the current local view; do not
restore a saved whole-store snapshot, which could overwrite a newer edit. An
offline network failure after a durable commit leaves the intent queued.

Use the existing [consistency policies](CONSISTENCY_MODES.md) for remote-acknowledged,
write-through, or queued local-first writes. A successful UI dispatch or a
successful compute job never establishes durability or remote acceptance.

## Effects, requests, and session replacement

`beginEffect(key)` invalidates the previous effect under that key. Its `dispatch`
returns false after supersession, close, reset, or store disposal. Distinct keys
can run concurrently. Always `close()` in `finally` in TS/Dart; Rust drops the
effect automatically, including if its future is dropped. Errors still
propagate to the command caller; use a typed failure action for visible status.

Use one projection key per view and issue a fresh read on every invalidation.
The most recently started read wins; this is a request fence, not a server
revision ordering algorithm. Serialize the sync owner's pull/rebase operations
and never invent ordering from message arrival time. All writes still enter the
durable queue even if their old UI result is no longer relevant.

At logout/session change: fence admission of new writes, invalidate effects and
clear UI state with `reset`, cancel old source subscriptions, and use the
existing authenticated lifecycle for draining/credential clearing. This state
API is not an authorization boundary. An accepted durable write may finish
after view disposal; logical UI cancellation must not delete it.

## Flutter

```dart
import 'package:opto_sync_state_flutter/opto_sync_state_flutter.dart';

// Inside a State object: create once in initState, not on every build.
late final count = StoreListenable(store, (state) => state.users.length);

// build():
ValueListenableBuilder<int>(
  valueListenable: count,
  builder: (context, value, child) => Text('$value users'),
);

// dispose(): count.dispose(); the session owner disposes store separately.
```

Provider/BLoC/Riverpod may own the dispatcher/listenable, without duplicating
the durable sync queue. Pure Dart and Flutter web can import
`package:opto_sync_reactive/state_store.dart` directly. The native compute entry
point below is separate so it is not pulled into browser builds.

## Off-main execution by platform

| Host | CPU work | Durable sync owner | Suspended/background execution |
| --- | --- | --- | --- |
| Desktop/mobile browser, TS, Rust WASM | Dedicated module Web Worker; optional 1–2 worker compute pool | One dedicated data worker, or existing tab owner guarded by Web Locks | Existing bounded Service Worker sync, where supported |
| Flutter web | JS/WASM Web Worker bridge | Browser storage/protocol owner | Browser lifecycle; no Dart isolate guarantee |
| Flutter Android/iOS/desktop | `NativeComputeExecutor` for finite pure tasks; persistent isolate for repeated data work | One isolate owns its database connection and sync runner | Existing WorkManager/BGTaskScheduler adapters |
| Native Rust desktop/mobile | Bounded `spawn_blocking` work on the host's runtime | One database/sync actor | Host mobile OS scheduler / existing desktop runner |
| MASH | Native server task/blocking executor | Server protocol implementation | Normal server lifecycle |

Start with two compute workers (one on constrained devices), cap accepted work,
and measure serialization overhead before increasing it. `spawn_local`, a
Leptos Action, Dioxus `spawn`/coroutine, and a Dart Future only arrange async
execution: they do not move synchronous parsing/reconciliation off the UI thread.

### Browser compute workers

```ts
// app module
import { ComputeWorkerPool } from '@opto-sync/reactive/compute-worker';
const compute = new ComputeWorkerPool<string, unknown[]>(
  () => new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module' }),
  { size: 2, maxPending: 32, timeoutMs: 30_000 },
);
const decoded = await compute.run(largeJsonText);

// decode-worker.ts (a separate module, bundled as a worker entry)
import { installComputeWorker } from '@opto-sync/reactive/compute-worker';
installComputeWorker(self, (text: string) => JSON.parse(text));
```

The pool uses versioned `opto.compute.v1` messages and request IDs, one active
job per worker, bounded FIFO admission, a timeout including queue wait, and
explicit disposal. Crashes/timeouts fail the pool and settle every accepted
caller; create a new pool explicitly. It does not auto-retry. Task failures are
bounded codes and do not expose exception text. `QUEUE_FULL` lets the caller
coalesce obsolete requests or retry later. Pass immutable sendable DTOs; do not
mutate queued input or transferred buffers. `run(input, transferList)` transfers
buffer ownership when the job is posted, so the sender must stop using them.

Use this pool for pure transformations, decoding, indexing, or independent
calculations, **not** competing push/pull loops or storage writes. A data worker
should initialize its own WASM merge engine once and own its IndexedDB queue,
checkpoint, and bounded protocol loop. It receives app commands, commits them,
and sends complete local-view DTOs carrying generation/request IDs to the UI.
The Rust examples show how native signals consume those DTOs through a fenced
async dispatcher. Applications supply their bundler-specific JS/WASM bridge.

Each independent worker has its own WASM memory. This pattern does not require
SharedArrayBuffer, shared-memory WASM threads, cross-origin isolation, or a
Rayon pool. Introduce those only for measured workloads that justify the extra
deployment and memory constraints. Never send DOM objects, UI signals, native
FFI pointers, or database handles through the worker boundary.

Dedicated workers belong to the foreground app and can be stopped when the
browser suspends it. A worker is not a mobile background-execution entitlement.
Service Workers are event-driven, can be killed, and have uneven Background Sync
support: always also sync at launch, foreground, and reconnection. Preserve the
existing durable queue/checkpoint/retry behavior across those events.

### Native Flutter compute

```dart
import 'dart:convert';
import 'package:opto_sync_reactive/native_compute.dart';

List<Object?> decodeRows(String text) => jsonDecode(text) as List<Object?>;
final compute = NativeComputeExecutor(size: 2, maxPending: 32);
final rows = await compute.run(decodeRows, largeJsonText);
// Owner teardown: compute.dispose().
```

This is a bounded executor using short-lived `Isolate.run` jobs, not a permanent
isolate pool. Top-level/static callbacks avoid capturing a widget, connection,
or entire application. For a high-frequency workload, use a persistent isolate
and `SendPort`/`ReceivePort` so setup and engine initialization are amortized.
The persistent sync isolate owns its storage connection; never create one sync
writer per compute slot. Plugin calls may require
`BackgroundIsolateBinaryMessenger` initialization and must follow plugin support.

Disposal rejects queued and active callers immediately. Already-running native
computations finish and exit naturally; only finite, trusted pure functions
belong here. There is no forced cancellation or timeout guarantee for native
`Isolate.run`. UI effect fences ignore old results. Native WorkManager and
BGProcessingTask expiration continue to be handled by the existing background
runner, independently of this foreground compute executor.

### Native Rust compute

Use the host runtime's existing blocking pool, with admission limited before
spawning. For example, an application-level `Arc<tokio::sync::Semaphore>` with
two permits can bound work submitted by async commands:

```rust,ignore
let permit = permits.clone().try_acquire_owned()?; // backpressure, no UI blocking
let value = tokio::task::spawn_blocking(move || {
    let _permit = permit;
    decode_or_transform(owned_input)
}).await?;
// Back on the UI executor: validate generation/request and dispatch the DTO.
```

Keep signals and the UI-thread `StateStore` out of that closure. Tokio blocking
work already running cannot be aborted by cancelling the async waiter. Keep
tasks finite and use explicit cooperative cancellation for expensive loops.
Do not add a second general threadpool just to perform already-asynchronous I/O.

## Verification and sources

[`client-state.yml`](../.github/workflows/client-state.yml) runs the common
corpus, the real queue integration, Chromium module workers, native Dart
isolates, Flutter widget lifecycle, Leptos/Dioxus cleanup, native/WASM Rust
builds, and the physical-crate dependency check. The examples are library/host
composition examples, not a deployed application or a replacement protocol
server. The MASH server supplies read-only sample routes.

The design follows the [Redux reducer purity guidance](https://redux.js.org/style-guide/),
[Leptos signals and read/write separation](https://book.leptos.dev/reactivity/working_with_signals.html),
[Dioxus context lifecycle](https://dioxuslabs.com/learn/0.7/essentials/basics/context/),
[Flutter isolates and web limitations](https://docs.flutter.dev/perf/isolates),
and [Web Worker message passing](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).
Leptos 0.8.20 and Dioxus 0.7.9 entry dependencies are pinned in the examples;
their resolved transitive graph is locked. These samples use current
`RwSignal::new`/read-only signals rather than older `create_rw_signal` examples.
