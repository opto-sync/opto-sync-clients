# `opto-sync-desktop`

Restart-safe desktop background synchronization contracts for native Rust hosts.

This crate does not add another mutation queue or reconciliation engine. A host
supplies a durable `DesktopLeaseStore`, then `DesktopSyncRunner` fences one
bounded protocol-v1 cycle at a time. The server's `(client_id, mutation_id)`
deduplication remains the final correctness boundary after crashes or ambiguous
responses.

The capability model distinguishes native Node/Electron/Flutter/Rust processes
from WASM webviews. WASM can use Service Worker events while available, but it
cannot claim an OS daemon, host-surviving execution, or raw TCP unless a native
bridge explicitly supplies those capabilities.

The in-memory lease store is for tests only. Production desktop applications
should implement the lease in the same SQLite database as the durable queue, or
another process-shared compare-and-swap store, with a monotonically increasing
fence and token+fence comparison on release.
