# Desktop background synchronization

This document defines the desktop lifecycle boundary for opto-sync. It extends
the merged Service Worker and mobile-worker foundation without adding a second
mutation queue, ledger, or reconciliation engine.

## One queue, one authority, several wake mechanisms

Every desktop runtime uses the existing protocol-v1 durable queue and immutable
`(clientId, mutationId)` identity. HTTP push/pull remains the commit-ordered
source of truth. WebSocket, Supabase Realtime, trusted native TCP, renderer
messages, tray events, Service Worker events, sleep/wake notifications, and
network-change notifications are wake hints or transport optimizations. They do
not acknowledge mutations or advance checkpoints by themselves.

A process must obtain a durable lease before inspecting or draining the queue.
The lease store must atomically:

1. grant only when no unexpired lease exists;
2. increment a monotonic fencing identity whenever it replaces an absent or
   expired lease;
3. release only when both token and fence still match;
4. derive expiration from a store-authoritative clock rather than trusting a
   process-supplied wall clock;
5. persist where every process that can drain the queue can observe it.

The configured lease TTL must exceed the bounded cycle budget plus cleanup
grace. A deadline is cooperative cancellation. The runner does not explicitly
release ownership until the callback returns, but an expiring lease cannot make
an uncooperative callback safe by itself: after TTL expiry, another process may
acquire a newer fence. Production callbacks must stop queue/checkpoint writes
before their grant expires. Any adapter that permits longer work must renew the
same token and fence atomically, and every queue/checkpoint mutation must reject
an older fence after a newer owner has been granted.

A `busy` acquisition is not an acknowledgement of the wake that caused it.
In-process trailing-wake coalescing protects mutations produced by the same
runner, but it cannot observe a mutation committed by another process after the
current owner inspected the queue. A production shared-store adapter must either
persist a dirty/wake generation that the owner rechecks before release or
schedule a durable retry no later than lease expiry. It must never simply drop
the wake because another owner was active.

The in-memory stores shipped with the TypeScript, Dart, and Rust surfaces are
for deterministic tests only. Their caller-supplied timestamps are test inputs,
not a production clock model. Production desktop applications should implement
the contract in the same SQLite database as the queue, or another
process-shared compare-and-swap store. Server deduplication remains the final
remote-commit correctness boundary if a process dies after a server commit but
before local release; fencing and transactional checkpoint rules remain the
local correctness boundary.

## Formally controlled runner lifecycle

The TypeScript, Dart, and Rust runners expose the same finite lifecycle projection:
`idle`, `acquiring`, `running`, `releasing`, and `closed`, with explicit
`wakePending`, `closeRequested`, `cancelRequested`, and `permitHeld` facts.
Every ownership change passes through the production `SyncLifecycleMachine`.
An event that is not defined for the current state fails closed instead of
guessing a recovery transition.

The Quint source of truth is
`formal/mobile_desktop_lifecycle.qnt`. TLC exhaustively explores its complete
finite state graph and checks that an execution permit exists exactly while a
cycle is running or releasing, closure is terminal, closing cannot retain a
wake, and cancellation is observable only while running. Separate Dart and
Rust, Dart, and TypeScript tests enumerate every event from every reachable
implementation state.

In particular, `close()` during asynchronous lease acquisition is modeled.
If the store later grants the fence, the runner enters `releasing`, releases
that exact grant, and returns a `cancelled` outcome without invoking application
code. A Rust callback panic is caught at the ownership boundary, the fence is
released, the machine returns to `idle`, and the panic is then resumed.

This proof covers the declared transition system, not arbitrary host behavior.
Durable-store atomicity, OS process termination, callback cooperation, and
transport correctness remain environmental assumptions with separate fencing,
restart, fault-injection, and integration tests.

## Runtime capability model

| Runtime | Persistent native runner | Service Worker events | Raw TCP | Survives host termination |
| --- | --- | --- | --- | --- |
| Node/Electron main process | host-dependent | optional renderer/PWA surface | native | only with an installed native runner/autostart host |
| Flutter desktop | host-dependent | only inside an embedded web surface | native plugin/bridge | only with an installed native runner/autostart host |
| Rust native | host-dependent | not intrinsic | native | only with an installed native runner/autostart host |
| WASM webview/PWA | no | capability-dependent and event-driven | no, unless a native bridge supplies it | no |

WASM does not become an operating-system daemon merely because it is embedded in
a desktop application. A native bridge may provide persistent execution or TCP,
but the capability belongs to that bridge. No runtime promises exact execution
intervals.

## TypeScript / Node / Electron

`DesktopSyncRunner` coalesces wake bursts, preserves one trailing wake that
arrives during an active cycle, shares one in-process drain promise, and obtains
a durable cross-process lease before invoking the protocol callback. It exposes
`close()` cancellation and bounded cycle deadlines. The package also exports a
capability resolver so Electron main processes, renderer/PWA surfaces, and
plain Node daemons do not report the same guarantees.

The runner also exposes its immutable formal lifecycle projection. A close that
races lease acquisition releases a late grant and reports `cancelled` without
starting application code.

Renderer processes and windows should post payload-free wake reasons to the
main/tray process. Credentials and mutation payloads stay in secure host state
and the durable queue; they must not be placed in IPC channel names, startup
arguments, scheduler metadata, or logs.

The Service Worker controller keeps a timed-out visible result installed until
the underlying callback actually settles. A callback that ignores `AbortSignal`
therefore cannot be overlapped by a later sync, periodic-sync, or message event
within the same worker lifetime.

## Dart / Flutter desktop

The Dart runner mirrors the same wake, lease, fence, deadline, and capability
contract. The callback must observe its `BackgroundSyncContext`; the runner will
not explicitly release a lease behind a non-cooperative callback merely to make
a timeout look successful. The callback must still return before lease expiry
unless the production adapter renews and enforces the fence. A process kill is
recovered through lease expiry plus server mutation idempotency.

A Flutter application may compose the runner in its foreground process, tray
process, or an explicitly installed user-level native host. A Dart isolate does
not survive process termination and must not be advertised as an OS service.

## Rust native

The `opto-sync-desktop` crate provides the same capability vocabulary and a
synchronous cooperative runner over a host-supplied `DesktopLeaseStore`. The
cycle receives a deadline and fence. Hosts must configure bounded HTTP/socket
operations, return before lease expiry, and condition queue/checkpoint changes
on the active fence. The library does not detach a callback and explicitly
release ownership while work may still be running.

## OS integration boundary

Autostart is optional and disabled by default. Host applications may integrate
with user-level launchd/login items on macOS, systemd user services or desktop
autostart on Linux, and user startup/Task Scheduler on Windows. Ordinary use
must not require privilege escalation. Uninstall and sign-out paths must remove
or disable the host cleanly.

Scheduler metadata must not contain access tokens, refresh tokens, service-role
credentials, database URLs, tenant secrets, mutation payloads, or stable device
identifiers. On process start, app update, resume, network restoration, or an
explicit local mutation, the host schedules one bounded reconciliation cycle.

## Failure model

The implementation assumes arbitrary duplicate wakes, response loss, process
crash, app update, sleep, hibernate, reboot, session rotation, and concurrent
window/process launches. Safety comes from durable queue state, fenced ownership,
immutable mutation identity, exact acknowledgement correlation, checkpoint
persistence after application, and retry-safe server behavior—not from a claim
that a desktop scheduler runs continuously or exactly once.

## Authenticated login and logout

Flutter/Dart hosts use `AuthenticatedSessionLifecycle`; native Rust hosts use
the matching `session_lifecycle` module, including async-host adapters that do
not require a particular executor. A successful login immediately wakes one
foreground sync for that exact subject, tenant, and auth epoch. Duplicate
notifications for the same epoch coalesce. An identity, tenant, or auth-epoch
switch requires an explicit logout first.

Logout ordering is normative: fence new session-scoped writes, run one bounded
protocol cycle, force-flush application-owned ORES OTEL providers, and only then
clear secure credentials. A transport/WebSocket acknowledgement is not delivery
evidence. The receipt separately accounts for mutations admitted during the
drain; the logout is drained only when admission was fenced, every row present
at cycle start has an exact server acknowledgement, the local checkpoint is
committed, and zero rows remain. Failures never convert pending data into
acknowledged data, and credential clearing is still attempted so an unavailable
collector cannot retain an in-memory login. Dart and Rust both refine
`formal/session_lifecycle_vectors.v1.json`.

## Current certification

The dedicated workflow runs:

- TypeScript fencing, coalescing, cancellation, and WASM capability tests on
  Linux, macOS, and Windows;
- Dart formatting, analysis, and a deterministic lease/wake self-test;
- Rust formatting, Clippy, and tests on Linux, macOS, and Windows.

The background-reactive workflow additionally verifies that a Service Worker
timeout cannot clear single-flight ownership while its underlying callback is
still running, alongside the real two-tab Chromium/IndexedDB test.

Consuming applications still need a store-authoritative shared-SQLite lease,
fence-checked queue/checkpoint writes, durable busy-wake retry, optional renewal,
installer/autostart, signing, real sleep/wake, updater handoff, and process-kill
evidence before claiming production desktop completion.
