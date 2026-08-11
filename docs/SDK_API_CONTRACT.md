# SDK capability and portable API contract

Rust, Dart, and TypeScript expose a shared capability inventory through
idiomatic names and storage types. The machine-readable source of truth is
[`../schema/opto-sync-sdk-api.v1.json`](../schema/opto-sync-sdk-api.v1.json),
validated by
[`../schema/opto-sync-sdk-api.schema.json`](../schema/opto-sync-sdk-api.schema.json).
Normalized request and result values live in
[`../schema/opto-sync-sdk-values.v1.schema.json`](../schema/opto-sync-sdk-values.v1.schema.json).

The contract covers durable upsert/delete queues, ordered pending reads,
immutable push batches, acknowledgement validation, pull checkpoints, snapshot
installation, reconciliation/rebase, HLC formatting and comparison, envelope
validation/provider audits, one sync cycle, and WebSocket transport. Each
operation binds all three languages. Six operations with shared schemas and
runtime corpus coverage are marked `portable`: HLC format/parse/compare,
envelope parsing, telemetry record creation, and fail-open telemetry delivery.
The other twelve remain `candidate` and carry machine-readable differences for
durability, parameters, result identities, validation, and state carriers.
They must not be presented as portable until new adapters and runtime tests
clear those differences. Names remain idiomatic (`snake_case` in Rust and
`lowerCamelCase` in Dart/TypeScript), while semantic operation ids stay stable.

The manifest pins the Rust reference engine's proposed
`https://opto-sync.dev/schema/merge-options.schema.json` document at source
commit `8ef3d4bb63738a90b1e3958500578aebb89ee8cc` and SHA-256
`d5bd069eefc24293e3f8d8e666bdbd1d2461b59853f73c0cea7bb7c0424d7bd8`.
It is explicitly a `candidate`, blocked on upstream-main adoption and
cross-runtime option parity; clients must not call it canonical yet.

Run the complete schema gate with:

```sh
(cd schema && npm ci && npm test)
```

`check-sdk-api-contract.mjs` compiles the contract, normalized values,
envelope, and telemetry schemas; requires the exact 18 capability ids and six
portable classifications; resolves every request/result reference; validates
high-risk HLC and telemetry cases; checks declared source symbols outside
comments; and verifies dependency release states. Language suites still
execute behavior against shared fixtures because declarations cannot prove
durability, transaction ordering, or fail-open behavior.

## Interfaces and logging

The manifest records the intended Zed coordinates
`ores-otel/ores-interfaces@^0.1.0` and
`oresoftware/next-loggers@^0.1.0`. Both integrations are application-injected:
opto-sync never installs a global OpenTelemetry provider and never flushes or
closes an application-owned logger.

Those coordinates are marked `pending-release` and are deliberately absent
from `.zpkg.toml`. Neither package has immutable public `v0.1.0` release
provenance yet, so a clean `zed install --frozen` cannot truthfully resolve
them. The contract gate rejects a premature manifest declaration; once both
packages are released, the status, root manifest, and committed lock must move
together and pass a clean public-registry install. A locally seeded registry is
not release evidence.

Telemetry uses the `opto.sync` namespace and the closed record in
[`../schema/opto-sync-telemetry.schema.json`](../schema/opto-sync-telemetry.schema.json).
Only bounded sync state, aggregate counts, stable error codes, and bounded
request/trace correlation are accepted. Table names, record and mutation IDs,
checkpoints, payloads, raw errors, URLs, headers, credentials, and arbitrary
attributes are rejected by the shared schema and fixture corpus.

Each primary SDK builds the same Ores/OpenTelemetry bridge record and exposes a
fail-open sink boundary. For example:

```ts
await emitProtocolSyncTelemetry(applicationOwnedOresSink, {
  runtime: 'typescript',
  kind: 'cycle.completed',
  status: 'idle',
  timestamp: new Date(),
  cycle: result,
});
```

The Dart spelling is `emitProtocolSyncTelemetry`; Rust uses
`emit_protocol_sync_telemetry`. Invalid metadata, sink exceptions, rejected
futures, returned sink errors, and Rust sink panics are contained. The emitter
does not own a sync cycle and therefore cannot alter its result or retry state.

The pinned `syncer.c` engine is also intentionally absent from `[dependencies]`: it
is already contained by the repository gitlink. Declaring it again could load
two different reconciliation revisions into one SDK install.
