# fmctl

`fmctl` is the Rust orchestration layer for executable specifications and
implementation-conformance tests. It is intentionally independent of opto-sync's
storage and runtime choices so the crate can move into `formal-methods.rs` without
changing its manifest or adapter protocols.

The current backend is Quint. The process boundary is generic: Rust, Node.js,
TypeScript, Go, Gleam, and Dart adapters are ordinary executables that consume one
JSON request on stdin and return one JSON response on stdout.

## Commands

Run from the repository root:

```bash
cargo run --manifest-path tools/fmctl/Cargo.toml -- validate
cargo run --manifest-path tools/fmctl/Cargo.toml -- check
cargo run --manifest-path tools/fmctl/Cargo.toml -- simulate
cargo run --manifest-path tools/fmctl/Cargo.toml -- verify
cargo run --manifest-path tools/fmctl/Cargo.toml -- trace
cargo run --manifest-path tools/fmctl/Cargo.toml -- doctor
```

All operations discover `formal/fm.toml` by default. Use `--workspace` and
`--manifest` for another repository or manifest. `--dry-run` prints the exact
argv/cwd/environment/artifact plan without starting a verifier.

`init` creates a schema-v1 manifest and a small Quint specification:

```bash
fmctl init \
  --project example \
  --model lease-machine \
  --main lease_machine \
  --spec formal/lease_machine.qnt
```

## One core, two interfaces

The CLI and server call the same `App` methods. Server mode is newline-delimited
JSON-RPC 2.0 on stdin/stdout:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"fm.capabilities"}' \
  '{"jsonrpc":"2.0","id":2,"method":"fm.plan","params":{"operation":"verify"}}' \
  '{"jsonrpc":"2.0","id":3,"method":"fm.shutdown"}' \
  | fmctl serve
```

The initial server deliberately executes jobs serially. It never interprets a
shell command, accepts paths outside the declared workspace, or changes verifier
semantics relative to the CLI. HTTP and MCP transports can wrap this core later.

## Manifest

`fm.toml` declares:

- the specification, state-machine entry points, invariants, and witnesses;
- pinned Quint and Java requirements;
- bounded simulation, verification, trace, timeout, and output settings;
- implementation adapters and their executable argv arrays.

`fmctl validate` rejects path traversal, unsupported backend names, duplicate or
invalid property identifiers, unpinned verifier tokens, active adapters without a
command, and invalid resource limits.

## Adapter protocol

An active adapter declares a command array in `fm.toml`:

```toml
[adapters.typescript]
strategy = "itf-json-driver"
target = "clients/ts"
status = "active"
command = ["node", "formal/adapter.mjs"]
```

`fmctl replay --adapter typescript --trace .formal-artifacts/example-0.itf.json`
sends a single `fmctl.adapter.v1` request to the adapter's stdin. The adapter must
write exactly one response JSON object to stdout; diagnostic logs belong on stderr.
A successful response must report every trace as passed and contain no mismatches.
The normative request/response schema is in
`formal/adapter-protocol.schema.json`.

The adapter receives canonical trace paths and compares observable protocol state,
not private IndexedDB, Drift, SQLite, BEAM, or in-memory layouts.

## Artifacts and exit behavior

Each external operation writes bounded stdout, stderr, and a normalized result JSON
under `.formal-artifacts/fmctl/`. Trace generation additionally writes ITF files.
The child process is killed after the manifest timeout, and output beyond the
configured byte limit is drained but not retained.

Exit status is zero only when the requested operation succeeds. Timeouts use 124;
manifest/configuration errors use stable low-numbered codes; model-checker and
adapter failures preserve a useful child status where possible.

## Current extraction boundary

The crate has no imports from the opto-sync clients. The only repository-specific
inputs are `formal/fm.toml` and the files named by that manifest. Extraction to a
neutral repository therefore consists of moving this directory and preserving the
schema/protocol compatibility tests.
