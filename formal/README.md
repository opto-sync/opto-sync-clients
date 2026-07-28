# Formal verification

This directory is the first vertical slice of a shared formal-methods workflow for
opto-sync, Fiducia, and the other state-machine-heavy repositories.

The design separates three concerns:

1. **A language-neutral behavioral specification.** Quint is the source of truth
   for states, actions, invariants, temporal properties, and counterexamples.
2. **A Rust orchestration layer.** A separate `fmctl.rs`/formal-methods repository
   should discover manifests like `fm.toml`, invoke model-checker backends, normalize
   traces, cache tools, and expose the same operations through a CLI, JSON-RPC, and
   eventually an MCP/HTTP server.
3. **Implementation adapters.** Rust, TypeScript/JavaScript, Dart, Go, and Gleam
   implementations replay generated traces and compare observable implementation
   state with the Quint model. The adapter boundary is trace JSON, not source-code
   parsing or language-specific reimplementation of the model checker.

This keeps the trusted design artifact independent of the runtime while still
letting Rust own the operational tooling and the first model-based test adapter.

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

The workflow pins Quint so local and CI semantics match. Java 17 or newer is
required by the model-checker backends.

```bash
QUINT='npx --yes --package=@informalsystems/quint@0.32.0 quint'

$QUINT typecheck formal/opto_sync_protocol.qnt

$QUINT run formal/opto_sync_protocol.qnt \
  --max-samples=10000 \
  --max-steps=40 \
  --invariant=protocol_safety \
  --witnesses \
    ambiguous_commit_reached \
    duplicate_retry_reached \
    reset_crash_reached

# Exhaustive verification of this finite model.
$QUINT verify formal/opto_sync_protocol.qnt \
  --backend=tlc \
  --invariant=protocol_safety

# Generate implementation-replay traces in Informal Trace Format (ITF).
mkdir -p .formal-artifacts
$QUINT run formal/opto_sync_protocol.qnt \
  --max-samples=500 \
  --max-steps=30 \
  --n-traces=8 \
  --mbt \
  --out-itf='.formal-artifacts/opto-sync-{seq}.itf.json'

# Replay every generated state through the production Rust ProtocolQueue API.
cargo run \
  --locked \
  --manifest-path clients/rust/Cargo.toml \
  --no-default-features \
  --example quint_itf_replay \
  -- .formal-artifacts/opto-sync-*.itf.json
```

## Rust implementation conformance

`clients/rust/examples/quint_itf_replay.rs` is an active ITF adapter, not a second
copy of the model. It reads the action and state metadata emitted by Quint and maps
those actions to public production APIs:

- `enqueue` calls `ProtocolQueue::queue_upsert` and checks contiguous allocation;
- `send` calls `push_request(1)` and retains the immutable request envelope;
- applied, rejected, and duplicate model outcomes synthesize protocol-v1 responses;
- malformed responses are passed to `acknowledge` and must be rejected without
  mutating the queue;
- valid `acknowledge` actions execute the real acknowledgement validation and
  confirmation transition;
- `pull` advances the real durable checkpoint;
- `finish_reset` executes `install_snapshot`, while reset crashes leave the queue
  unchanged and retryable.

After every model state, the adapter compares the real queue's observable
projection with Quint: next mutation id, pending and confirmed identities,
in-flight request, response envelope/validity, checkpoint, and snapshot-replacement
phase. Server-only fields such as ledger contents and effect counters remain model
state; they are not falsely claimed as client implementation coverage.

The formal-methods workflow generates fresh traces and replays all of them before
uploading the ITF and replay logs. The ordinary Rust `--all-targets` jobs also
compile and lint the adapter, including without default SQLite features.

## Cross-language implementation checks

Each additional adapter should consume the same ITF action/state shape and return
the same observable projection.

| Runtime | Adapter target | Status |
|---|---|---|
| Rust | `clients/rust/examples/quint_itf_replay.rs` against `ProtocolQueue` | Active |
| TypeScript | Node/Dexie driver invoking `OptoSyncClient` and projecting IndexedDB state | Planned |
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

`fm.toml` is a provisional manifest for the planned Rust orchestrator. Until that
CLI exists, the GitHub Actions workflow invokes Quint and the Rust adapter directly,
so the proof and conformance gate remains independently reproducible.
