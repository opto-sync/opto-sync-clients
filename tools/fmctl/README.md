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
cargo run --locked --manifest-path tools/fmctl/Cargo.toml -- validate
cargo run --locked --manifest-path tools/fmctl/Cargo.toml -- check
cargo run --locked --manifest-path tools/fmctl/Cargo.toml -- simulate
cargo run --locked --manifest-path tools/fmctl/Cargo.toml -- verify
cargo run --locked --manifest-path tools/fmctl/Cargo.toml -- trace
cargo run --locked --manifest-path tools/fmctl/Cargo.toml -- doctor
```

All operations discover `formal/fm.toml` by default. Use `--workspace` and
`--manifest` for another repository or manifest. `--dry-run` prints the exact
argv/cwd/environment/artifact plan without starting a verifier.

`trace` validates the complete generated corpus before it can pass: the exact
configured number of regular, non-empty JSON files must exist and their combined
model-based testing metadata must contain every required action. `replay` then
binds an adapter response to the selected language and exact canonical trace set.

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
- pinned Quint, Java, Node.js, and Rust requirements;
- bounded simulation, verification, trace, timeout, and output settings;
- deterministic trace backend, seed, count, and required-action coverage; and
- implementation adapters and their executable argv arrays.

`fmctl validate` rejects path traversal, unsupported backend names, duplicate or
invalid property identifiers, unpinned verifier tokens, active adapters without a
command, output paths that escape through symlinked ancestors, and invalid
resource limits.

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

Each model or adapter operation writes bounded stdout, stderr, and one final
normalized result JSON under `.formal-artifacts/fmctl/`. Trace generation
additionally writes ITF files. Artifact writes are atomic and constrained to the
canonical workspace.

Child processes receive a recorded, minimal environment with isolated runtime,
Cargo, and npm directories. On Unix, each child runs in its own process group so
a timeout terminates descendants as well as the direct process. Output beyond the
configured byte limit is drained but not retained, and truncation makes the
operation fail.

Exit status is zero only when the requested operation succeeds. Timeouts use 124;
manifest/configuration errors use stable low-numbered codes; model-checker and
adapter failures preserve a useful child status where possible.

## Current extraction boundary

The crate has no imports from the opto-sync clients. The only repository-specific
inputs are `formal/fm.toml` and the files named by that manifest. It is still an
incubator, however: `fmctl.adapter.v1` is the repository-local protocol exercised
by this gate, not yet a compatibility promise from the future shared
`formal-methods.rs` release. Extraction under DEN-565/DEN-580 must preserve the
manifest, artifact, process-supervision, and protocol-binding tests before this
copy can be retired.
