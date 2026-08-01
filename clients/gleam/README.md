# opto_sync_client for Gleam

This package is the transport-neutral Gleam implementation of opto-sync
protocol v1. It provides a bounded, monotonically numbered offline mutation
queue, immutable push batches, strict acknowledgement validation, checkpoint
tracking, tombstones, and native reconciliation through the `syncer.c` BEAM
NIF.

Persist the returned opaque `Queue` together with the optimistic application
row in one database transaction. The package intentionally does not choose an
HTTP client or a BEAM database library; those are application concerns.

```gleam
let assert Ok(queue) = opto_sync_client.new("stable-device-id")
let assert Ok(#(queue, mutation)) =
  opto_sync_client.enqueue_upsert(
    queue,
    "tasks",
    "task-1",
    "{\"title\":\"offline\",\"updatedAt\":2}",
    None,
    False,
  )
```

`opto_sync_schema` validates the cross-language ingest envelope defined by
`schema/opto-sync-envelope.schema.json`, using strict `gleam/dynamic/decode`
decoders that reject unknown properties rather than dropping them:

```gleam
let assert Ok(envelope) = opto_sync_schema.parse_envelope(blob)
```

Each `IngestRecord` carries the table, record id, operation, base revision, and
the payload as decoded dynamic values, ready to enqueue. The TypeScript, Dart,
and Rust validators are held to the same fixture corpus in `schema/fixtures/`.

Run the suite against the compiled NIF using the repository CI environment:

```sh
OPTO_SYNC_BEAM_EBIN=../../../syncer.c/bindings/beam/_build/dev/lib/opto_sync_nif/ebin \
OPTO_SYNC_ELIXIR_EBIN=/path/to/elixir/ebin \
gleam test
```
