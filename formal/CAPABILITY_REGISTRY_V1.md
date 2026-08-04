# `fm.adapter.stream.v1` capability registry

Hello capabilities are a semantic set with one canonical JSON-array encoding.
The authoritative machine-readable registry is
`formal/protocol-fixtures/stream/capabilities.v1.json`.

## Registry order

```text
reset, apply, observe, settle, snapshot, restore, fault, close
```

`reset`, `apply`, `observe`, and `close` are mandatory. `settle`, `snapshot`,
`restore`, and `fault` are optional. `hello` is the handshake operation and must
never be advertised as a post-handshake capability.

A valid `capabilities` array is therefore a **strict subsequence** of the
registry above that contains every mandatory operation. It contains no duplicate
or unknown operation. Examples:

```json
["reset", "apply", "observe", "close"]
["reset", "apply", "observe", "settle", "fault", "close"]
["reset", "apply", "observe", "settle", "snapshot", "restore", "fault", "close"]
```

## Wire policy

Out-of-order wire input is rejected rather than silently reordered. This makes a
received byte sequence either canonical or invalid and prevents language
collection order from changing transcript identity.

SDK producers may accept an unordered application-level set, but they must
normalize it to the registry order before constructing a hello response. The Go
SDK exposes `CanonicalizeCapabilitySetV1` for this purpose. Rust and every future
TypeScript, Dart, and Gleam streaming SDK must expose the equivalent operation.

Validation is transactional: duplicate, missing, unknown, `hello`-advertised, or
out-of-order capability arrays must not consume the pending hello request or
transition the session to ready.

## Schema and fixtures

`formal/adapter-stream-protocol.schema.json` enumerates all sixteen valid v1
capability arrays and applies the hello-result schema to successful hello
responses. The shared corpus includes:

- `valid/minimal-capabilities.jsonl`;
- `invalid/duplicate-capability.jsonl`;
- `invalid/missing-required-capability.jsonl`;
- `invalid/hello-capability.jsonl`;
- `invalid/unknown-capability.jsonl`; and
- `invalid/out-of-order-capability.jsonl`.

These fixtures are protocol assets, not product-model traces. Every streaming SDK
must consume them directly rather than copying the cases into a language-local
order table without a drift check.
