# opto-sync client SDKs

These runtime-specific SDK baselines preserve the existing product bindings;
missing targets receive a transport-neutral client configuration baseline. The
repository currently ships as one complete package around its bundled,
git-pinned native core. It does not declare `opto-sync-interfaces` or
`opto-sync-lib` as installable Zed dependencies.

The .NET target under `dotnet/` adds supported C# and F# reconciliation
surfaces for SAFE Stack and other managed applications. Both languages call
the pinned native core, share the same CRDT-style default policy as the primary
clients, and run as separate executable contract suites in CI. This additive
binding remains outside the canonical portable API manifest until its durable
queue and transport surface reaches parity with the three primary SDKs.

Rust, Dart, and TypeScript additionally share the versioned portable surface in
[`../schema/opto-sync-sdk-api.v1.json`](../schema/opto-sync-sdk-api.v1.json).
That manifest is validated by
[`../schema/opto-sync-sdk-api.schema.json`](../schema/opto-sync-sdk-api.schema.json)
and maps each semantic operation to its idiomatic language symbol. The contract
gate refuses a missing language binding, a stale declaration, a mismatched
envelope schema id, or dependency-coordinate drift.

The reconciliation bindings use the reference engine's canonical
`https://opto-sync.dev/schema/merge-options.schema.json` identifier. The API
contract records the exact upstream source commit and schema digest; individual
operations remain candidates wherever runtime option carriers or behavior still
differ. This repository does not maintain a competing copy.

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
