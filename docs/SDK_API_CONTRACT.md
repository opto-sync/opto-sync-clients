# Portable SDK API contract

Rust, Dart, and TypeScript expose the same portable opto-sync behavior through
idiomatic names and storage types. The machine-readable source of truth is
[`../schema/opto-sync-sdk-api.v1.json`](../schema/opto-sync-sdk-api.v1.json),
validated by
[`../schema/opto-sync-sdk-api.schema.json`](../schema/opto-sync-sdk-api.schema.json).

The contract covers durable upsert/delete queues, ordered pending reads,
immutable push batches, acknowledgement validation, pull checkpoints, snapshot
installation, reconciliation/rebase, HLC formatting and comparison, envelope
validation/provider audits, one sync cycle, and WebSocket transport. Each
operation binds all three languages. Names remain idiomatic (`snake_case` in
Rust and `lowerCamelCase` in Dart/TypeScript), while the semantic operation id
is stable for documentation, code generation, and test-org conformance.

Reconciliation option keys and strategy values are governed by the Rust
reference engine's `https://opto-sync.dev/schema/merge-options.schema.json`
contract (`opto-sync/syncer.rs`, `schema/merge-options.schema.json`). The SDK
manifest pins source commit `8ef3d4bb63738a90b1e3958500578aebb89ee8cc` and
SHA-256 `d5bd069eefc24293e3f8d8e666bdbd1d2461b59853f73c0cea7bb7c0424d7bd8`
instead of copying its enums into this repository, so the three client adapters
cannot silently invent a second option vocabulary.

Run the complete schema gate with:

```sh
(cd schema && npm ci && npm test)
```

`check-sdk-api-contract.mjs` compiles the contract schema, validates the v1
manifest, confirms the canonical envelope schema id, checks every declared
language symbol in source, and verifies the exact Zed dependency coordinates.
The language test suites continue to execute behavior against the shared
fixture corpus; a declaration-only match cannot replace those tests.

## Interfaces and logging

The root Zed package declares:

```toml
[dependencies]
"ores-otel/ores-interfaces" = "^0.1.0"
"oresoftware/next-loggers" = "^0.1.0"
```

The root package version intentionally remains `0.2.0` because the repository's
immutable approved-release controller targets `v0.2.0`. A later version must
carry new approval evidence; the existing release evidence must not be edited
or reinterpreted as an approval for a different version.

The second coordinate is the current package published by
`github.com/ores-otel/ores.otel.log`. Native integrations remain injection
based: an application supplies its logger/context adapter at its composition
root. opto-sync does not install a global OpenTelemetry provider and does not
flush or close an application-owned logger.

Telemetry uses the `opto_sync` namespace and a metadata-only payload policy.
Safe fields include operation name, table, record id, mutation id, checkpoint,
batch/count values, duration, and stable error code. Mutation payloads, access
tokens, session values, and complete transport bodies are prohibited because
they can contain user or authentication data.

The closed event shape lives in
[`../schema/opto-sync-telemetry-event.schema.json`](../schema/opto-sync-telemetry-event.schema.json).
Each primary SDK exposes an optional sink plus a lifecycle adapter:

```ts
const result = await observeSyncCycle(
  (event) => logger[event.level](event.name).addFields(event.fields).send(),
  () => loop.syncNow(),
);
```

```dart
final result = await observeSyncCycle(
  (event) => logger.log(
    LogLevel.values.byName(event.level.name),
    event.name,
    fields: event.fields.toJson(),
  ),
  loop.syncNow,
);
```

```rust
let result = observe_sync_cycle(Some(&|event: &TelemetryEvent| {
    let log_event = match event.level {
        TelemetryLevel::Debug => logger.debug(vec![serde_json::json!(&event.name)]),
        TelemetryLevel::Info => logger.info(vec![serde_json::json!(&event.name)]),
        TelemetryLevel::Warn => logger.warn(vec![serde_json::json!(&event.name)]),
        TelemetryLevel::Error => logger.error(vec![serde_json::json!(&event.name)]),
    };
    let fields = serde_json::to_value(&event.fields)
        .map_err(|error| error.to_string())?
        .as_object()
        .cloned()
        .ok_or_else(|| "telemetry fields must serialize as an object".to_string())?;
    log_event
        .add_fields(fields)
        .send()
        .map(|_| ())
        .map_err(|error| error.to_string())
}), || driver.sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut store));
```

The adapter emits started/succeeded/failed lifecycle events. Logger exceptions,
rejected futures, returned errors, and Rust sink panics are contained; the
original sync result or error is preserved. Neither the adapter nor opto-sync
flushes or closes the application-owned logger.

The pinned `syncer.c` engine is intentionally absent from `[dependencies]`: it
is already contained by the repository gitlink. Declaring it again could load
two different reconciliation revisions into one SDK install.
