# Store-authoritative SQLite desktop coordination

This document describes the production-oriented coordination adapters for
Node/Electron, native Dart/Flutter desktop, and Rust. They layer durable
ownership and wake handoff around the existing protocol-v1 queue. They do **not**
add another mutation queue, merge engine, checkpoint model, or remote commit
authority.

The adapters are exported from:

- `@opto-sync/reactive/sqlite-desktop` for Node/Electron;
- `package:opto_sync_reactive/opto_sync_reactive_sqlite.dart` for native
  Dart/Flutter desktop; and
- `opto_sync_desktop::sqlite` for Rust.

The Dart entrypoint is intentionally separate from the package's cross-platform
entrypoint. Web and WASM consumers must not accidentally import a native process
coordination contract or advertise native persistence.

## What is authoritative

HTTP push/pull and immutable `(clientId, mutationId)` identities remain the
remote commit contract. SQLite owns only local coordination:

- one lease row per queue partition;
- an opaque, ephemeral owner token;
- a lossless monotonic fence;
- an expiry derived from SQLite time;
- a durable wake generation; and
- the highest generation completed by a fenced owner.

Credentials, refresh tokens, database URLs, tenant secrets, mutation payloads,
and stable device identifiers must not be written to the coordination table or
logs. `ownerId` exists for host-local diagnostics and outcome reporting but is
not persisted by the coordinators.

## Store-authoritative acquisition

Every adapter uses `BEGIN IMMEDIATE` and SQLite's `unixepoch('subsec')` clock.
Caller wall-clock values cannot make an active lease look expired. Replacing an
absent or expired owner increments the persisted signed 64-bit fence. Public
fences and generations cross language boundaries as decimal strings so
JavaScript cannot round values above its safe-integer range and all three
implementations share one lossless representation.

Renewal retains the same token and fence and fails when ownership is stale or
expired. Release compares both token and fence, so a delayed old process cannot
remove a newer owner's lease.

## Durable wake handoff

Every local mutation or external wake calls `signalWake()` before attempting to
drain. The generation is committed even when acquisition returns `busy`; busy
therefore does not acknowledge or lose work.

A runner captures the generation present at acquisition. After one bounded
protocol cycle, `complete()` rechecks the generation in the same immediate
transaction used to advance the handled generation. It releases only when no
newer wake exists. When another process committed a wake after queue inspection,
the owner renews the same fence and executes a trailing cycle. If a wake arrives
after release, it remains dirty with no owner and the signalling process or a
later process-start wake can acquire it.

A process that exits after an ambiguous remote result but before local
completion leaves `wake_generation > handled_generation`. After lease expiry, a
new fence replays that durable work. Server mutation idempotency prevents the
replay from applying the same remote commit twice.

## Fence-checking local writes

Lease ownership alone is insufficient once TTL expiry can grant a newer owner.
Queue and checkpoint adapters must execute local mutations through the
language-specific `withFencedWrite` helper or perform an equivalent check in the
same SQLite transaction as the write. The helper checks token, fence, and
store-time expiry before and after the callback while holding the immediate
write transaction. A stale owner must stop writing and let the new owner
reconcile.

Do not check the fence in one transaction and update queue state in a later
transaction. That creates a time-of-check/time-of-use gap and defeats fencing.
The callback must remain synchronous and must not manually commit, roll back, or
mutate the coordinator row.

## Runner behavior

The SQLite-coordinated runners provide:

- durable wake-before-acquire ordering;
- bounded busy polling through the active lease horizon;
- one in-process drain with reason coalescing;
- cooperative cycle deadlines;
- durable generation recheck before release;
- same-fence renewal for trailing cycles;
- dirty-state preservation on cycle, completion, release, or process failure;
- HTTP-authoritative semantics, with sockets and IPC remaining wake hints.

The cycle callback receives the grant, fence, captured wake generation,
deadline/cancellation context, and coordinator. It must use bounded transports
and place all local queue/checkpoint changes behind the active fence.

## Evidence in this repository

The Node, Dart, and Rust corpora use real SQLite files and real operating-system
child processes. Together they cover:

- extreme caller clock skew while SQLite time preserves mutual exclusion;
- a wake committed after queue inspection forcing a trailing cycle;
- stale-write and stale-release rejection after a newer fence;
- one holder and multiple independent processes contending for one partition;
- process termination before local completion, followed by expiry and replay;
- runner-level generation recheck and same-fence renewal.

The desktop workflow executes each native adapter on Linux, macOS, and Windows,
in addition to the existing capability and background-runner contracts.

## Remaining DEN-1078 scope

The language adapters do not close DEN-1078. Remaining certification work
includes:

- integrating the coordinator with concrete protocol-v1 queue and checkpoint
  write paths in consuming Electron, Flutter, and Rust hosts;
- one deterministic cross-language corpus that opens the same database and
  proves Node, Dart, and Rust exclude each other and preserve every wake;
- explicit database-busy, updater-handoff, sleep/wake, reboot/relaunch, and
  renewal-loss schedules in consuming applications;
- installer, autostart, signing, sign-out, and uninstall evidence where a host
  advertises persistent native execution.

Until those consumers and lifecycle schedules pass their required evidence, the
merged desktop foundation and language adapters must not be presented as full
production desktop certification.
