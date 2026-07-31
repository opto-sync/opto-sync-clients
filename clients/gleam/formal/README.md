# Gleam / BEAM ITF conformance adapter

This directory contains the non-published implementation adapter for the
repository's Quint protocol-v1 model. It consumes the same normalized ITF trace
corpus as the Rust, TypeScript, and Dart adapters and speaks
`fmctl.adapter.v1` over stdin/stdout.

## Architecture

The adapter deliberately separates operational and semantic concerns:

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
canonical observation.

## Projection checked after every action

- next mutation id;
- pending and confirmed mutation-id sets;
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

From the repository root, first generate normalized traces and build the tools,
then build the Gleam package and invoke `fmctl`:

```sh
cd clients/gleam
gleam deps download
gleam test
gleam build
cd ../..

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

All model-checking bounds, tool versions, model hashes, seeds, trace hashes, and
adapter command provenance remain owned by the repository-level formal-methods
manifest and `fmctl` report.
