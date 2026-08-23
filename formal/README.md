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

The machine-by-machine proof boundary, current evidence, and prioritized gaps
are maintained in [`STATE_MACHINE_ASSURANCE.md`](STATE_MACHINE_ASSURANCE.md).

## Protocol model

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

TLC also checks two temporal properties over the complete finite state graph:

- `queued_work_eventually_settles`: once the finite workload is non-empty, it
  eventually drains;
- `replica_eventually_catches_up`: a lagging local checkpoint eventually equals
  the server checkpoint.

Both claims are conditional on named strong-fairness assumptions for send,
server resolution, valid acknowledgement, malformed-response disposal, pull,
and reset completion. This is deliberate: an unconstrained network or a user
callback that never returns cannot support an honest liveness claim.

## Mobile and desktop lifecycle model

`mobile_desktop_lifecycle.qnt` is a second finite transition system for the
application runners themselves. It is implemented directly by
`SyncLifecycleMachine` in reactive TypeScript, reactive Dart, and the Rust
desktop crate, and the Flutter headless dispatcher uses the Dart runner to
coalesce concurrent native invocations. The model makes wake queuing, permit acquisition, execution,
cooperative cancellation, release, close-during-acquire, and process abort
explicit. Undefined runtime transitions fail closed.

TLC exhaustively checks every reachable state in the declared finite model.
One deterministic 128-trace ITF corpus is replayed through the production
TypeScript, Dart, and Rust machines. Every adapter independently requires all 12
model actions plus seven state-dependent fault/close/wake scenarios, and compares
phase, pending wake, close/cancel requests, and permit ownership after every
action. Implementation-side exhaustive transition tests remain a second,
independent check. This proves the selected transition-system
projection within its boundary; OS process loss, durable-store correctness,
transport behavior, and user callback cooperation remain explicit environmental
assumptions covered by fencing, restart, and fault tests rather than being
overstated as a whole-product proof.

The lifecycle model additionally verifies that permit acquisition, a running
cycle, and a requested close eventually settle under explicit fairness for the
permit provider, user callback, and durable-fence release. Process abort remains
an unrestricted fault and is included in the checked state graph.

## Connectivity override model

`connectivity_override.qnt` specifies the shared core behind browser, Dart,
Flutter, Android, and Apple connectivity adapters. It separates the latest
automatic platform observation from the exposed state. While total-offline mode
is active, platform observations continue to update the cache but cannot leak an
online state or verified-internet claim; restoring automatic mode exposes the
latest cache atomically.

TLC exhaustively checks all 92 reachable states for three composed safety
contracts: forced offline is authoritative, automatic mode exposes exactly the
cache, and verification is true exactly for exposed Internet state. A
deterministic 64-trace corpus covers all eight actions and both idempotent
same-mode setter scenarios, and is actively replayed through the production
TypeScript and Dart watchers. The adapter also checks whether a semantic-change
listener fired for each action.

There is intentionally no connectivity liveness theorem: a platform observer
may remain silent forever and an application may remain in total-offline mode
forever. Android and Apple OS adapters are integration-tested but are not yet
active ITF refinements; extracting their pure reducers is tracked as the next
native proof step in the assurance ledger.

## Run locally

The canonical entry point is `fmctl`. Local runs require Node.js 22, Java 17 or
newer, Rust 1.88.0, and Dart 3.12.1 for the Dart adapter; the manifest pins the
exact Quint package, Rust evaluator seed, trace count, and execution limits used
by CI. `nix develop` supplies the exact Rust version, and implementation adapters
inherit the pinned shell rather than selecting an ambient rustup toolchain.

```bash
cargo build --locked --release --manifest-path tools/fmctl/Cargo.toml
FMCTL=tools/fmctl/target/release/fmctl

$FMCTL validate
$FMCTL check
$FMCTL simulate
$FMCTL verify
$FMCTL trace --output '.formal-artifacts/opto-sync-{seq}.itf.json'

(cd clients/ts && npm ci && npm run build)
(cd clients/dart && dart pub get)

traces=()
for trace in .formal-artifacts/opto-sync-*.itf.json; do
  traces+=(--trace "$trace")
done
$FMCTL replay --adapter rust "${traces[@]}"
$FMCTL replay --adapter typescript "${traces[@]}"
$FMCTL replay --adapter dart "${traces[@]}"

for manifest in \
  formal/mobile_desktop_lifecycle.fm.toml \
  formal/connectivity_override.fm.toml; do
  $FMCTL --manifest "$manifest" validate
  $FMCTL --manifest "$manifest" check
  $FMCTL --manifest "$manifest" simulate
  $FMCTL --manifest "$manifest" verify
  $FMCTL --manifest "$manifest" trace
done
```

The hosted workflow additionally replays the lifecycle corpus through Rust,
TypeScript, and Dart and the connectivity corpus through TypeScript and Dart.
Each manifest declares its active adapter commands and exact observable
projection, so `fmctl replay` remains the canonical entry point.

`temporal_properties` in an `fm.toml` manifest are passed only to model
verification—never simulation—as a single pinned Quint `--temporal` argument.
`fmctl validate` rejects temporal claims that do not configure a verifier and
includes every temporal property in its JSON report, so CI evidence records the
exact liveness contract that was checked.

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

## Dart/Drift implementation conformance

`clients/dart/tool/formal_itf_replay.dart` is the non-published Dart adapter for
DEN-586. It consumes the same `fmctl.adapter.v1` request as the Rust and
TypeScript runners and maps all 17 actions to the public `OptoSyncClient` and
`OptoSyncDatabase` APIs. It is a tool entry point rather than a `lib/` source, so
it is not exported to package consumers.

Every trace receives an isolated file-backed SQLite database. The adapter closes
and reopens Drift after queue insertion, ambiguous request or response loss,
acknowledgement, pull checkpoint changes, reset start, reset crash, and reset
completion. These reopen boundaries make persistence claims observable instead
of accidentally relying on one live connection.

The projection checks durable next, pending, confirmed, and allocated mutation
identities; immutable request retries; response identity and validity; pull
checkpoint; and reset phase after every model state. Malformed acknowledgements
execute the production validator and compare canonical before/after SQLite row
snapshots. Reset-crash actions execute `installSnapshot` with a failing
replacement callback and require both queue and metadata to remain unchanged.
ITF integers stay as Dart `BigInt` values until encoded as canonical protocol
decimal strings.

```bash
(cd clients/dart && dart pub get)
(cd clients/dart && dart run tool/formal_itf_replay.dart \
  ../../.formal-artifacts/opto-sync-*.itf.json)
```

The hosted gate formats and analyzes this tool, then replays the same 16 traces
and 41 states per trace used by the other runtimes. A protocol-mode mismatch
returns the trace path, state index, action, expected value, and observed value
through the strict adapter response schema.

## Cross-language implementation checks

Every adapter consumes the same raw ITF corpus and projection vocabulary.

| Runtime | Adapter target | Status |
|---|---|---|
| Rust | `formal/rust-itf-replay` against `ProtocolQueue` | Active |
| TypeScript | `formal/typescript-itf-replay.mjs` against public `OptoSyncClient` + Dexie | Active |
| Dart | `clients/dart/tool/formal_itf_replay.dart` against public `OptoSyncClient` + Drift/SQLite | Active |
| Go | Generic trace-runner SDK; opto-sync can add a client when one exists | Planned |
| Gleam | Production protocol state + volatile BEAM replay store | Active (no durable-restart claim) |

Lifecycle refinement is active for Rust, TypeScript, and Dart. Connectivity
override refinement is active for TypeScript and Dart; the native Kotlin and
Swift bridges remain explicitly tracked as tested rather than model-refined.

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

The Rust protocol client also runs Kani over the production predicates for
batch limits, signed-bigint mutation allocation, and acknowledgement
watermarks. The pinned `syncer.c` repository owns complementary CBMC proofs for
its production C reconciliation comparator and Kani proofs for the Rust FFI
boundary; those are intentionally separate from this queue lifecycle model.

## Deliberate limits of this first model

This slice uses one client, one logical stream, one-mutation requests, and three
mutation identities. It abstracts authorization, payload content, SQL implementation
details, HLC merge semantics, multi-record batches, and multiple tenants. Those are
separate models or refinements rather than dimensions added to one unreviewable state
space.

The next opto-sync models should cover, in order:

1. protocol sync-loop scheduling across single-flight execution, coalesced
   hints, stop/abort, offline recovery, permanent failure, and bounded backoff;
2. two-process SQLite lease and fencing behavior across expiry, renewal, stale
   completion, process death, and takeover;
3. WebSocket connection, request-correlation, timeout, close, fallback, and
   reconnect behavior under a deterministic socket and clock;
4. immutable `(clientId, mutationId) -> content`, multi-item batch gap/reuse
   rejection, and multi-client convergence;
5. HLC monotonicity, LWW/FWW policies, tombstone resurrection, and pending rebase;
6. additional historical IndexedDB migration fixtures (Drift/SQLite v1/v2
   identity adoption, interruption, reopen, and rollback are enforced by the
   Dart production migration tests);
7. Go protocol trace replay and durable Gleam storage refinement.

`fm.toml` is the active schema-v1 manifest for the incubating Rust orchestrator.
GitHub Actions builds and tests `fmctl`, runs every Quint phase through it, checks
its JSON-RPC interface, and replays the same validated ITF corpus through all three
active adapters. Extraction into the shared DEN-565/DEN-580 workspace remains a
separate lifecycle step; this repository keeps the complete gate reproducible
until that shared release is available.
