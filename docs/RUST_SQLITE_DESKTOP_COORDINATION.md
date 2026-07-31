# Rust SQLite desktop coordination

`opto-sync-desktop::sqlite` is the Rust-native DEN-1113 adapter for the
versioned `opto_sync_desktop_coordination_v1` contract. It coordinates local
processes around the existing protocol-v1 durable queue; it does not add a
second mutation queue, merge engine, checkpoint model, or remote commit path.

## Contract

The Rust and Node/Electron adapters share the same SQLite row semantics:

- one row per queue partition;
- an opaque, ephemeral owner token;
- a monotonic signed 64-bit fence exposed publicly as a decimal string;
- expiry derived from SQLite `unixepoch('subsec')` time;
- durable wake and handled generations; and
- immediate write transactions for acquisition, renewal, completion, release,
  and fence-checked queue/checkpoint writes.

A process calls `signal_wake` before attempting ownership. `busy` is therefore
non-acknowledging: the wake remains durable even when another process owns the
partition. `complete` advances the handled generation and releases only when no
newer wake exists. `SqliteCoordinatedDesktopSyncRunner` renews the same fence
and executes a trailing cycle when another process commits a later wake.

## Fenced local writes

An expiring lease is not sufficient by itself. Queue and checkpoint adapters
must execute each local mutation through `with_fenced_write` or perform the
same token, fence, and store-time expiry check inside the write transaction.
The helper checks ownership before and after the callback while the immediate
transaction is held. A stale owner receives `SqliteDesktopError::StaleFence`
and must stop writing.

Never check ownership in one transaction and update queue state in another.
That time-of-check/time-of-use gap allows an expired process to overwrite state
after SQLite has granted a newer fence.

## Evidence

The Rust integration corpus uses real SQLite files and real child processes. It
covers caller clock skew, post-inspection wakes, stale-write and stale-release
rejection, multiprocess contention, process termination before local
completion, expiry/replay, and runner-level trailing-cycle handoff. The desktop
workflow executes format, Clippy, and tests on Linux, macOS, and Windows.

## Remaining DEN-1078 work

This Rust slice does not certify every desktop host. Dart/Flutter parity, a
shared cross-language fixture format, concrete Electron/Flutter/Rust queue and
checkpoint adoption, updater/sleep/reboot schedules, and installer/signing
lifecycle evidence remain open under DEN-1078.
