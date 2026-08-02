# Go formal-adapter SDK incubator

This module is the Go implementation of `fm.adapter.stream.v1`. It currently
lives in `opto-sync-clients` because the standalone `ORESoftware/formal-methods.rs`
repository has not yet been created through an available GitHub write path. Its
module path and APIs are intentionally extraction-ready:

```text
github.com/ORESoftware/formal-methods.rs/sdk/go
```

The SDK uses only the Go standard library and provides:

- bounded one-object-per-line UTF-8 framing;
- strict protocol, request-correlation, capability, and reset-generation checks;
- deterministic canonical JSON and ITF `#bigint`, `#set`, and `#map` handling;
- a protocol-only `Serve` loop for implementation adapters;
- byte-for-byte validation against the repository's shared Rust/TypeScript/Dart/
  Gleam transcript fixtures;
- a consequence-bearing fencing-lease reference machine with idempotent acquire,
  cancellation-before-acquire, cancellation-after-grant, logical expiry,
  monotonic fencing, snapshot/restore, restart, and rollback rejection;
- fuzz, race, malformed-frame, stale-generation, duplicate-ID, canonicalization,
  and end-to-end server tests.

## Validate

From this directory:

```sh
gofmt -w .
go test ./...
go test -race ./...
go vet ./...
go build ./cmd/fm-go-reference
```

The reference executable reads protocol requests from stdin, writes only
protocol responses to stdout, and writes fatal diagnostics to stderr.

## Claim boundary

This module verifies framing, canonicalization, session ordering, and the
included lease reference machine. It is not a model checker and does not prove
that a product-specific adapter exposes the correct abstraction. Product claims
still require model-owned traces, implementation replay, fault bounds, and
explicit assumptions.

Extraction into the future standalone repository must preserve the shared
fixtures and exact protocol bytes; it must not introduce a third protocol or
narrow ITF integers to host `int`.
