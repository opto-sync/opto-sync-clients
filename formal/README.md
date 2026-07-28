# Formal verification

This directory is the first vertical slice of a shared formal-methods workflow for
opto-sync, Fiducia, and the other state-machine-heavy repositories.

The design separates three concerns:

1. **A language-neutral behavioral specification.** Quint is the source of truth
   for states, actions, invariants, temporal properties, and counterexamples.
2. **A Rust orchestration layer.** `tools/fmctl` is the in-repository incubator
   for the `formal-methods.rs` workspace tracked by DEN-565/DEN-580. It discovers
   manifests like `fm.toml`, invokes model-checker backends, validates generated
   traces, supervises implementation adapters, and exposes the same deterministic
   application core through a CLI and newline-delimited JSON-RPC server.
3. **Implementation adapters.** Rust, TypeScript/JavaScript, Dart, Go, and Gleam
   implementations replay generated traces and compare observable implementation
   state with the Quint model. The adapter boundary is trace JSON, not source-code
   parsing or language-specific reimplementation of the model checker.

This keeps the trusted design artifact independent of the runtime while still
letting Rust own the operational tooling and protocol schemas.

## Current model

`opto_sync_protocol.qnt` models the protocol-v1 client/server lifecycle with a
small finite domain so TLC can exhaust the complete reachable state graph.

It covers:

- contiguous client mutation identities and a contiguous server ledger;
- atomic commit of ledger outcome, watermark, effect, and pull checkpoint;
- permanent rejection that advances the watermark without executing an effect;
- a committed mutation whose response is lost;
- identical retry and duplicate replay without double application;
- malformed/stale responses that do not name the in-flight request;
- acknowledgement tied to the exact immutable request rather than a bare
  watermark;
- pull checkpoint ordering, compaction, `RESET_REQUIRED`, snapshot replacement,
  and a crash during replacement;
- preservation of pending local mutations across ambiguous commits and resets.

The primary invariant is `protocol_safety`. It composes smaller invariants so a
counterexample identifies the contract that failed:

- `ledger_is_contiguous`
- `outcomes_partition_ledger`
- `effects_are_exactly_once`
- `acknowledgement_is_safe`
- `checkpoints_are_ordered`
- `reset_is_atomic`
- `in_flight_is_queued`
- `response_is_bounded`

The booleans `ambiguous_commit_reached`, `duplicate_retry_reached`, and
`reset_crash_reached` are reachability witnesses. CI asks the simulator to reach
those scenarios so an accidental overconstraint cannot make the safety proof
vacuous.

## Run locally

The canonical entry point is `fmctl`. Local runs require Node.js 22, Java 17 or
newer, and Rust 1.88.0; the manifest pins the exact Quint package, Rust evaluator
seed, trace count, and execution limits used by CI.

```bash
cargo build --locked --release --manifest-path tools/fmctl/Cargo.toml
FMCTL=tools/fmctl/target/release/fmctl

$FMCTL validate
$FMCTL check
$FMCTL simulate
$FMCTL verify
$FMCTL trace --output '.formal-artifacts/opto-sync-{seq}.itf.json'

(cd clients/ts && npm ci && npm run build)

traces=()
for trace in .formal-artifacts/opto-sync-*.itf.json; do
  traces+=(--trace "$trace")
done
$FMCTL replay --adapter rust "${traces[@]}"
$FMCTL replay --adapter typescript "${traces[@]}"
```

`fmctl plan <operation>` or `--dry-run` prints the exact argv, working directory,
sanitized environment, resource bounds, and artifact destinations without
starting the verifier.

## Rust implementation conformance

`formal/rust-itf-replay` is an active ITF adapter, not a second copy of the
model. It is a separate `publish = false` diagnostic crate whose dependency on
`opto-sync-client` disables default features. Keeping it outside `clients/rust`
means neither Cargo packaging nor the isolated Zed Rust target ships the
conformance tool to library consumers. The binary reads the action and state
metadata emitted by Quint and maps those actions to public production APIs:

- `enqueue` calls `ProtocolQueue::queue_upsert` and checks contiguous allocation;
- `send` calls `push_request(1)`, retains the first immutable request envelope,
  and requires every retry of that mutation to be byte-for-byte equivalent;
- applied, rejected, and duplicate model outcomes synthesize protocol-v1 responses;
- malformed responses are passed to `acknowledge` and must be rejected without
  mutating the queue;
- valid `acknowledge` actions execute the real acknowledgement validation and
  confirmation transition;
- `pull` advances the real durable checkpoint;
- `finish_reset` executes a successful `install_snapshot`; reset crashes execute
  the real API with a failing replacement callback and require the serialized
  queue to remain exactly unchanged and retryable.

After every model state, the adapter compares the real queue's observable
projection with Quint: next mutation id, pending and confirmed identities,
in-flight request, response envelope/validity, checkpoint, and snapshot-replacement
phase. Server-only fields such as ledger contents and effect counters remain model
state; they are not falsely claimed as client implementation coverage.

The formal-methods workflow pins the Quint version, Rust evaluator backend, and
trace seed. Its 16 generated traces cover every one of the model's 17 actions
with the current model. The adapter independently refuses to pass if any action
is missing, so duplicate retry, committed-response loss, and reset-crash code
cannot silently become vacuous. The workflow formats, lints, tests, and replays
the non-published crate with the Rust 1.88 client compatibility toolchain before
uploading the ITF and replay logs.

## TypeScript/Dexie implementation conformance

`formal/typescript-itf-replay.mjs` is a non-published Node adapter for DEN-583.
It loads the normally built `@opto-sync/client` package through its public
CommonJS entry point; it does not contain a second queue implementation.
`fake-indexeddb` supplies the Node IndexedDB runtime, so the same Dexie schema,
transactions, durable sequence, queue rows, metadata, and public protocol
methods used by consumers execute during replay. Keeping the adapter outside
`clients/ts` also keeps it out of both the npm package and the isolated
TypeScript source target.

For each raw ITF state, the driver reads Quint's `mbt::actionTaken` and
`mbt::nondetPicks` metadata without rewriting the trace, maps the action to a
public client operation, and compares this canonical projection:

- durable next mutation id;
- pending, confirmed, and all allocated mutation-id sets;
- immutable in-flight request identity;
- response identity, watermark, checkpoint, and validity;
- local pull checkpoint; and
- snapshot replacement phase.

The adapter additionally retains the first complete request for each mutation
and requires every retry to be deeply identical. Mismatched acknowledgements
execute the real validator and must leave all queue and metadata rows unchanged.
Reset crashes execute `installSnapshot` with a failing replacement callback and
must preserve the checkpoint and pending queue exactly; successful resets assert
that authoritative replacement ran before the checkpoint advanced.

Server ledger and effect facts remain model inputs used only to synthesize
protocol responses. They are not claimed as TypeScript implementation coverage.

```bash
(cd clients/ts && npm ci && npm run build)
node formal/typescript-itf-replay.mjs \
  .formal-artifacts/opto-sync-*.itf.json
```

Each trace receives a fresh database that is deleted after replay. Tagged ITF
integers are handled as JavaScript `BigInt` values, so protocol decimal strings
are never narrowed to IEEE-754 numbers. A mismatch reports the trace, state
index, action, and first divergent field. Like the Rust adapter, the TypeScript
adapter independently fails unless the complete trace suite covers all 17 model
actions.

## Cross-language implementation checks

Every adapter consumes the same raw ITF corpus and projection vocabulary.

| Runtime | Adapter target | Status |
|---|---|---|
| Rust | `formal/rust-itf-replay` against `ProtocolQueue` | Active |
| TypeScript | `formal/typescript-itf-replay.mjs` against public `OptoSyncClient` + Dexie | Active |
| Dart | VM/Drift driver using the same command/state JSON schema | Planned |
| Go | Generic trace-runner SDK; opto-sync can add a client when one exists | Planned |
| Gleam | BEAM runner for implemented protocol codec/state transitions | Planned |

Adapters must never compare private storage layout byte-for-byte. They compare
observable protocol state: pending identities, request envelope, durable
acknowledgements, checkpoint, authoritative record revision/tombstone, and error
class. This lets implementations use IndexedDB, SQLite, files, or another store
without weakening the behavioral contract.

## Verification layers

No single tool should be stretched beyond its strengths:

- **Quint + TLC**: exhaustive safety and temporal checking over deliberately small,
  finite distributed state machines.
- **Quint + Apalache**: bounded symbolic checking for larger integer/time domains
  and fault combinations.
- **Quint Connect / ITF adapters**: conformance between the abstract model and real
  runtime behavior.
- **Loom**: Rust thread/interleaving checks for small concurrent components.
- **Kani**: bounded code-level proofs for pure or tightly scoped Rust functions.
- **Creusot or similar deductive verification**: selected algorithms whose value
  justifies contracts and proof maintenance.
- **Property/fault testing**: broad randomized exploration and regression of every
  discovered counterexample.

A green model checker proves the model and selected bounds, not the entire product.
The implementation adapter and crash/network tests are what prevent the model from
becoming an accurate description of code nobody actually runs.

## Deliberate limits of this first model

This slice uses one client, one logical stream, one-mutation requests, and three
mutation identities. It abstracts authorization, payload content, SQL implementation
details, HLC merge semantics, multi-record batches, and multiple tenants. Those are
separate models or refinements rather than dimensions added to one unreviewable state
space.

The next opto-sync models should cover, in order:

1. immutable `(clientId, mutationId) -> content` and batch gap/reuse rejection;
2. pull pagination, filtered global checkpoints, and commit ordering;
3. HLC monotonicity, LWW/FWW policies, tombstone resurrection, and pending rebase;
4. IndexedDB/Drift/SQLite transaction and restart boundaries;
5. multi-client convergence and TypeScript/Dart/Gleam trace replay.

`fm.toml` is the active schema-v1 manifest for the incubating Rust orchestrator.
GitHub Actions builds and tests `fmctl`, runs every Quint phase through it, checks
its JSON-RPC interface, and replays the same validated ITF corpus through both
active adapters. Extraction into the shared DEN-565/DEN-580 workspace remains a
separate lifecycle step; this repository keeps the complete gate reproducible
until that shared release is available.
