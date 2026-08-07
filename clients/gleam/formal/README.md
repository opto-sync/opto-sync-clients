# Gleam / BEAM ITF conformance adapter

This directory contains the non-published implementation adapter for the
repository's Quint protocol-v1 model. It consumes the manifest-defined ITF
trace corpus shared with the Rust, TypeScript, and Dart adapters and speaks
repository's Quint protocol-v1 model. It consumes the same normalized ITF trace
corpus as the Rust, TypeScript, and Dart adapters and speaks
`fmctl.adapter.v1` over stdin/stdout.

## Architecture

The adapter deliberately separates operational and semantic concerns:

- `formal/quint-itf-replay.sh` launches pre-built BEAM VMs without invoking the
  compiler, preserving protocol-only stdout. `fmctl.adapter.v1` submits a batch,
  but each trace runs in a fresh BEAM process and fresh adapter state; the
  launcher validates each one-trace result and aggregates the canonical batch
  response. This prevents state leakage between traces without weakening
  fmctl's exact trace-count binding.
- `src/opto_sync_formal_replay_ffi_v2.erl` reads the original, unmodified ITF
  files through OTP 27's map/list JSON representation, traverses states, derives
  allocated IDs from `next_id`, accepts the model's `Idle` representation alias,
  and reports the first divergent trace/state/action. Empty JSON arrays remain
  arrays; they are never reclassified as objects.
- `src/opto_sync_formal_adapter.gleam` serializes canonical observations and
  exercises the production request/response validator.
- `src/opto_sync_formal_projection.gleam` delegates queue mutation, request
  construction, response validation, acknowledgement, and checkpoint changes to
  the production client, retaining only model-observation metadata that the
  public queue does not store.
- `formal/quint-itf-replay.sh` launches a pre-built BEAM VM without invoking the
  compiler, preserving protocol-only stdout.
- `src/opto_sync_formal_replay_ffi.erl` reads files/stdin, traverses ITF states,
  and reports the first divergent trace/state/action.
- `src/opto_sync_formal_adapter.gleam` serializes canonical observations and
  exercises the production request/response validator.
- `src/opto_sync_formal_projection.gleam` remains the production protocol state
  implementation used for every transition.

The Erlang harness never reconstructs Gleam record/variant internals. It calls
public production functions for enqueue, server outcomes, acknowledgement,
checkpoint advancement, reset begin/crash/finish, response validation, and
canonical observation. The retired compatibility harness that rewrote empty
arrays and required synthetic model fields has been removed.
canonical observation.

## Projection checked after every action

- next mutation id;
- pending and confirmed mutation-id sets;
- contiguous allocated-id domain derived from `next_id`;
- applied/rejected known outcomes;
- immutable in-flight request identity;
- response mutation id, watermark, checkpoint, validity, and request binding;
- contiguous allocated-id domain;
- applied/rejected known outcomes;
- immutable in-flight request identity;
- response mutation id, watermark, checkpoint, and request binding;
- local pull checkpoint; and
- reset replacement phase.

The adapter maps all current model actions: `init`, `enqueue`, `send`,
`apply_new`, `reject_new`, `reply_duplicate`, mismatched-response injection,
committed/uncommitted request loss, malformed-response discard,
`acknowledge`, `pull`, `compact`, reset begin/crash/finish, and `idle`.

## Run locally

From the repository root, build `fmctl`, validate the manifest, generate the
manifest-defined corpus, build the Gleam package, and replay every generated
trace through the active `gleam` adapter entry:

```sh
cargo build --locked --manifest-path tools/fmctl/Cargo.toml --bin fmctl
cargo run --locked --manifest-path tools/fmctl/Cargo.toml --bin fmctl -- \
  --manifest formal/fm.toml validate
cargo run --locked --manifest-path tools/fmctl/Cargo.toml --bin fmctl -- \
  --manifest formal/fm.toml trace

cd clients/gleam
gleam deps download
gleam format --check
From the repository root, first generate normalized traces and build the tools,
then build the Gleam package and invoke `fmctl`:

```sh
cd clients/gleam
gleam deps download
gleam test
gleam build
cd ../..

trace_args=()
for trace in .formal-artifacts/opto-sync-clients-protocol-v1-*.itf.json; do
  trace_args+=(--trace "$trace")
done
cargo run --locked --manifest-path tools/fmctl/Cargo.toml --bin fmctl -- \
  --manifest formal/fm.toml \
  replay \
  --adapter gleam \
  "${trace_args[@]}"
```

`fmctl` writes the structured replay result beneath
`.formal-artifacts/fmctl/`. The dedicated workflow also retains the corpus,
stdout/stderr logs, and a provenance file containing tool versions plus SHA-256
hashes for the manifest, model, adapter protocol schema, launcher, production
projection, Gleam adapter, replay entry point, and active Erlang harness.

cargo run --locked --manifest-path tools/fmctl/Cargo.toml --bin fmctl -- \
  replay \
  --manifest formal/fm.toml \
  --trace '.formal-artifacts/gleam/opto-sync-*.itf.json' \
  --adapter-language gleam \
  --adapter-command 'cd clients/gleam && sh formal/quint-itf-replay.sh' \
  --output .formal-artifacts/gleam-itf-replay.json
```

## Claim boundary

This adapter proves bounded trace conformance for the production Gleam protocol
state functions. Its store is intentionally volatile BEAM state. It does **not**
claim durable restart recovery, SQLite transaction semantics, transport
fairness, or eventual delivery. Those claims require a real persistent Gleam
store and explicit close/reopen/crash tests rather than an in-memory map.

All model-checking bounds, exact required-action coverage, tool versions, model
hashes, seeds, trace hashes, adapter command, and projection-source hashes remain
owned by `formal/fm.toml`, `fmctl`, and the retained workflow provenance.
All model-checking bounds, tool versions, model hashes, seeds, trace hashes, and
adapter command provenance remain owned by the repository-level formal-methods
manifest and `fmctl` report.
