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

The reconciliation bindings point to the reference engine's proposed
`https://opto-sync.dev/schema/merge-options.schema.json` identifier. It remains
a candidate until the upstream schema lands and all runtimes expose the same
option set; this repository does not maintain a competing copy.

The API contract records the pending Zed coordinates
`ores-otel/ores-interfaces@^0.1.0` and
`oresoftware/next-loggers@^0.1.0`. They remain application-injected and are not
declared as installable dependencies until immutable public releases and a
clean frozen lock exist. This SDK never installs or replaces a process-global
OpenTelemetry provider.

All three primary SDKs expose `createProtocolSyncTelemetryRecord` and
`emitProtocolSyncTelemetry` (idiomatic `snake_case` in Rust). The closed
`../schema/opto-sync-telemetry.schema.json` contract permits bounded state,
aggregate counts, stable error codes, and request/trace correlation. It rejects
table names, record and mutation IDs, checkpoints, payloads, raw errors,
credentials, and arbitrary attributes. Sink failures are always contained.
