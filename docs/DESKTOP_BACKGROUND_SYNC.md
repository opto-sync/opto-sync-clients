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
4. persist where every process that can drain the queue can observe it.

The in-memory stores shipped with the TypeScript, Dart, and Rust surfaces are
for deterministic tests only. Production desktop applications should implement
the contract in the same SQLite database as the queue, or another
process-shared compare-and-swap store. Server deduplication remains the final
correctness boundary if a process dies after a remote commit but before local
release.

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

Renderer processes and windows should post payload-free wake reasons to the
main/tray process. Credentials and mutation payloads stay in secure host state
and the durable queue; they must not be placed in IPC channel names, startup
arguments, scheduler metadata, or logs.

## Dart / Flutter desktop

The Dart runner mirrors the same wake, lease, fence, deadline, and capability
contract. The callback must observe its `BackgroundSyncContext`; the runner will
not release a lease behind a non-cooperative callback merely to make a timeout
look successful. A process kill is recovered through the lease expiry plus
server mutation idempotency.

A Flutter application may compose the runner in its foreground process, tray
process, or an explicitly installed user-level native host. A Dart isolate does
not survive process termination and must not be advertised as an OS service.

## Rust native

The `opto-sync-desktop` crate provides the same capability vocabulary and a
synchronous cooperative runner over a host-supplied `DesktopLeaseStore`. The
cycle receives a deadline and fence. Hosts should configure bounded HTTP/socket
operations and return by the deadline; the library does not detach an
uncooperative callback and release its lease while work may still be running.

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

## Current certification

The dedicated workflow runs:

- TypeScript fencing, coalescing, cancellation, and WASM capability tests on
  Linux, macOS, and Windows;
- Dart formatting, analysis, and a deterministic lease/wake self-test;
- Rust formatting, Clippy, and tests on Linux, macOS, and Windows.

Consuming applications still need installer/autostart, signing, real sleep/wake,
updater handoff, process-kill, and shared-SQLite lease evidence before claiming
production desktop completion.
