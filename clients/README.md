# opto-sync client SDKs

These runtime-specific SDK baselines depend on the `opto-sync-interfaces`
and `opto-sync-lib` Zed packages. Existing product bindings are preserved;
missing targets receive a transport-neutral client configuration baseline.

Rust, Dart, and TypeScript additionally share the versioned portable surface in
[`../schema/opto-sync-sdk-api.v1.json`](../schema/opto-sync-sdk-api.v1.json).
That manifest is validated by
[`../schema/opto-sync-sdk-api.schema.json`](../schema/opto-sync-sdk-api.schema.json)
and maps each semantic operation to its idiomatic language symbol. The contract
gate refuses a missing language binding, a stale declaration, a mismatched
envelope schema id, or dependency-coordinate drift.

The reconciliation bindings also point to the reference engine's canonical
`https://opto-sync.dev/schema/merge-options.schema.json` identifier. Option keys
and strategy values stay owned by `opto-sync/syncer.rs`; this repository does
not maintain a competing copy.

Cross-organization request/error types come from the Zed package
`ores-otel/ores-interfaces`. Structured events use
`oresoftware/next-loggers` (the package published from
`github.com/ores-otel/ores.otel.log`). Logger/trace providers are injected by
applications; this SDK never installs or replaces a process-global
OpenTelemetry provider. Emit metadata such as operation, table, record id,
mutation id, counts, checkpoints, latency, and error code—never record payloads,
auth tokens, or complete server responses.

All three primary SDKs expose `createTelemetryEvent`, `emitTelemetry`, and
`observeSyncCycle` (idiomatic `snake_case` in Rust). The lifecycle adapter wraps
the existing sync-cycle entry point, preserves the exact result/error, ignores
sink failures, and emits only fields allowed by
`../schema/opto-sync-telemetry-event.schema.json`.
