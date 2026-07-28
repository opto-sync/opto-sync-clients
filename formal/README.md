# Formal verification

This directory is the first vertical slice of a shared formal-methods workflow for
opto-sync, Fiducia, and the other state-machine-heavy repositories.

The design separates three concerns:

1. **A language-neutral behavioral specification.** Quint is the source of truth
   for states, actions, invariants, temporal properties, and counterexamples.
2. **A Rust orchestration layer.** The `formal-methods.rs` workspace tracked by
   DEN-565/DEN-580 should discover manifests like `fm.toml`, invoke model-checker
   backends, normalize traces, supervise implementation adapters, and expose the
   same deterministic library through a CLI before any remote service is added.
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

The workflow pins Quint so local and CI semantics match. Java 17 or newer is
required by the model-checker backends.

```bash
QUINT='npx --yes @informalsystems/quint@0.32.0'

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
```

## TypeScript/Dexie implementation replay

DEN-583 adds `clients/ts/formal/quint-itf-replay.mjs`. The driver imports the
normally compiled `OptoSyncClient`; it does not contain a second queue
implementation. `fake-indexeddb` supplies the Node IndexedDB runtime, so the
same Dexie transactions, schema, durable sequence, queue rows, metadata, and
public protocol methods used by browser clients execute in CI.

For each ITF state the driver maps the model action to one public client
operation and then compares this canonical projection:

- durable next mutation id;
- pending, confirmed, and all allocated mutation-id sets;
- immutable in-flight request identity;
- response identity, watermark, checkpoint, and validity;
- local pull checkpoint; and
- snapshot replacement phase.

Server ledger/effect facts remain model inputs used to synthesize protocol
responses. The adapter is responsible for proving client behavior: exact
mutation allocation, insertion ordering, request construction, rejection of a
mismatched acknowledgement without IndexedDB mutation, acknowledgement of the
exact sent batch, checkpoint persistence, and snapshot completion.

```bash
cd clients/ts
npm ci
npm run build
node formal/quint-itf-replay.mjs ../../.formal-artifacts/opto-sync-*.itf.json
```

Each trace receives a fresh database, and the database is closed/deleted after
replay. Tagged ITF integers are handled as JavaScript `BigInt` values so the
adapter never silently narrows protocol decimal strings to IEEE-754 numbers.
A mismatch reports the trace, state index, action, and first divergent field.

## Cross-language implementation checks

Every adapter consumes the same generated ITF corpus and projection vocabulary.

| Runtime | Initial adapter target | Status |
|---|---|---|
| Rust | `ProtocolQueue` production state machine | In review under DEN-573 |
| TypeScript | `OptoSyncClient` + Dexie/IndexedDB | Active under DEN-583 |
| Dart | Drift/SQLite queue and snapshot store | Planned |
| Go | Generic DEN-581 protocol/trace SDK; opto-sync has no Go client yet | Planned |
| Gleam | BEAM protocol codec/state transitions | Planned |

Adapters must never compare private storage layout byte-for-byte. They compare
observable protocol state so implementations may use IndexedDB, SQLite, files,
or another store without weakening the behavioral contract.

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

This slice uses one client, one logical stream, and three mutation identities. It
abstracts authorization, payload content, SQL implementation details, HLC merge
semantics, multi-record batches, and multiple tenants. Those are separate models or
refinements rather than dimensions added to one unreviewable state space.

The next opto-sync models should cover, in order:

1. immutable `(clientId, mutationId) -> content` and batch gap/reuse rejection;
2. pull pagination, filtered global checkpoints, and commit ordering;
3. HLC monotonicity, LWW/FWW policies, tombstone resurrection, and pending rebase;
4. IndexedDB/Drift/SQLite transaction and restart boundaries;
5. multi-client convergence and cross-runtime trace replay.

`fm.toml` is a provisional manifest for the planned Rust orchestrator. Until that
CLI exists, the GitHub Actions workflow invokes Quint and the TypeScript adapter
directly and therefore remains an independently reproducible verification gate.
