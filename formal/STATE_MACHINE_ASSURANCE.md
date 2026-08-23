# State-machine assurance ledger

Audit date: 2026-08-22

This ledger answers a narrower and more useful question than “is opto-sync
formally verified?”: for each critical state machine, which properties are
machine checked, which production implementations refine the model, and which
environmental assumptions remain outside the proof boundary?

## Assurance levels

- **M3 — implementation refinement:** an exhaustive finite model checks named
  safety and, where meaningful, liveness properties; deterministic
  model-generated traces are replayed through production code; the adapter
  independently requires complete action coverage.
- **M2 — model checked:** an exhaustive finite model checks named properties,
  but one or more production implementations do not yet replay its traces.
- **M1 — code-level proof:** bounded symbolic or deductive checks run against
  production functions, without a temporal refinement claim.
- **T — tested:** deterministic, property, fault, or cross-process tests exist,
  but there is no model-to-code proof bridge.

These levels are intentionally not additive certifications. M3 proves the
selected abstraction and observable projection over the declared finite domain.
It does not prove an operating system, database engine, network, compiler, or
arbitrary application callback.

## Current ledger

| Machine / boundary | Risk | Assurance | Checked claims | Production refinement | Remaining boundary |
|---|---:|---:|---|---|---|
| Protocol-v1 queue, acknowledgement, pull, and reset | Critical | M3 | Exactly-once effects; immutable retry identity; safe acknowledgement; monotonic checkpoints; atomic reset; fair eventual settlement and catch-up | Rust `ProtocolQueue`, TypeScript Dexie/IndexedDB, Dart Drift/file-backed SQLite, and Gleam replay one shared 16-trace corpus covering all 17 actions | One client, one stream, one-item batches, three mutation identities; payload merge and authorization are abstracted |
| Mobile/desktop runner lifecycle | Critical | M3 | Permit ownership; legal phases; close/cancel safety; wake coalescing; fair acquisition, cycle, and close settlement | Production Rust, TypeScript, and Dart `SyncLifecycleMachine` implementations replay one shared 128-trace corpus covering all 12 actions and seven critical state-dependent scenarios | OS process survival, callback termination, durable lease correctness, and scheduler delivery are assumptions |
| Connectivity total-offline override and cached automatic state | High | M3 for TS/Dart core; T for native bridges | Forced offline is authoritative; cached observations cannot leak; restore exposes the latest cache; setters are idempotent; only semantic changes emit | Production TypeScript and Dart manual watchers replay one shared 64-trace corpus covering all 8 actions and both repeated same-mode setter scenarios | Android `ConnectivityManager`, Apple `NWPathMonitor`/probe callbacks, Flutter method-channel ordering, and native locks are integration-tested rather than trace-refined |
| Rust mutation allocation, batch bounds, and acknowledgement watermark arithmetic | High | M1 | Bounded production predicates cannot allocate invalid identities, exceed limits, or acknowledge outside permitted bounds | Kani harnesses call production Rust predicates | No temporal scheduling or durable-restart claim |
| C timestamp comparator and Rust FFI discriminants in pinned `syncer.c` | High | M1 | Bounded comparator ordering/antisymmetry and invalid ABI guards; C/Rust strategy-discriminant agreement | CBMC includes the production C translation unit; Kani checks production Rust binding constants | The bound is the documented timestamp domain, not arbitrary JSON reconciliation |
| TypeScript/Dart protocol sync-loop scheduler (`stopped`, `idle`, `syncing`, `offline`, `backoff`, `error`) | Critical | T | Single-flight execution, retry/backoff, reset ordering, paging bounds, malformed-response failure, stop/abort behavior | Runtime unit, fault, and live PostgreSQL tests | No temporal model or shared Rust/TS/Dart scheduler refinement yet |
| Rust/Dart SQLite desktop lease, fencing, wake generation, renewal, and recovery | Critical | T | Cross-process exclusion, stale-fence rejection, expiry takeover, renewal, completion, crash recovery | Native SQLite and subprocess tests | No exhaustive lease/fencing model; real time, SQLite locking, and process death remain environmental dimensions |
| WebSocket request multiplexing and reconnect lifecycle | High | T | Correlation, timeout, close failure, retryability, bounded fallback, reconnect backoff | Rust/TypeScript/Dart transport tests | No common connection-state model; socket and timer scheduling are not refined |
| Browser service-worker and Android/iOS background scheduler registration | High | T | Bounded invocation, retry/failure mapping, offline suppression, platform adapter structure | Browser, Flutter, Kotlin, Java, Swift, and Objective-C tests/static gates | Browser/OS delivery is best effort by platform contract and cannot honestly be promised as liveness |

## Exhaustive model evidence

The checked state counts are recorded here to make accidental weakening visible
in review. They are evidence for these exact model revisions, not fixed targets
that future extensions must preserve.

| Model | Complete TLC graph | Temporal branches | Deterministic refinement corpus |
|---|---:|---:|---:|
| `opto_sync_protocol.qnt` | 297,526 generated / 29,497 distinct; depth 26 | 2 | 16 traces, 17/17 actions required |
| `mobile_desktop_lifecycle.qnt` | 301 generated / 58 distinct; depth 11 | 3 | 128 traces; 12/12 actions and 7/7 critical scenarios required |
| `connectivity_override.qnt` | 645 generated / 92 distinct; depth 8 | None: no pending environmental operation exists in this abstraction | 64 traces; 8/8 actions and 2/2 idempotence scenarios required |

The connectivity model deliberately has no liveness theorem. A network observer
may remain silent forever, and an application may leave total-offline mode
enabled forever. Adding unconditional “eventually online” or “eventually
automatic” would be a false claim. The lifecycle and protocol liveness theorems
instead name strong-fairness assumptions for operations controlled by the
environment.

## Audit findings addressed

1. The lifecycle model was checked in isolation, while the three production
   machines only enumerated their own hand-maintained transition tables. That
   could let model and code drift together without detection. Active ITF replay
   adapters now compare the model projection after every transition.
2. Quint model-based-test instrumentation did not attribute actions that placed
   nested nondeterministic branches below an outer action. Generated lifecycle
   traces therefore contained an empty action name for affected paths. Those
   transitions are now single named actions with conditional next-state values,
   and the trace generator must cover every action before CI can pass.
3. Total-offline override behavior existed independently in TypeScript, Dart,
   Kotlin, and Swift without a language-neutral contract. The new connectivity
   model establishes the core cache/override/emission contract and actively
   refines the production TypeScript and Dart cores.
4. The formal workflow did not execute lifecycle refinement at all. CI now
   checks, simulates, exhaustively verifies, generates deterministic corpora,
   validates adapters, and replays both lifecycle and connectivity models in
   addition to the protocol model.

## Highest-priority remaining proof work

1. Model the protocol sync-loop scheduler, including single flight, coalesced
   hints, stop during an active cycle, offline recovery, retryable versus
   permanent failure, bounded backoff, and “has more pending” reruns. Refine the
   TypeScript and Dart loops and the closest Rust driver projection through one
   corpus.
2. Model the durable SQLite lease/fencing coordinator with two processes, lease
   expiry, wake generations, renewal, crash, stale completion, and takeover.
   Replay through Rust and Dart against an abstract clock before adding selected
   Loom interleavings for the in-process wrapper.
3. Separate the WebSocket connection/reconnect machine from protocol request
   semantics, then refine the Rust, TypeScript, and Dart transports with a
   deterministic fake socket and fake clock.
4. Extract the cache/override reducer from Android and Apple OS adapters so
   Kotlin and Swift can consume the same ITF connectivity corpus without
   requiring live platform networking frameworks. Java and Objective-C wrappers
   should remain thin delegation tests rather than duplicate models.

## Verifier tooling caveats

Quint 0.32.0 launches its pinned Apalache 0.56.1 helper on port 8822 while
compiling a model for TLC. Two verifier processes on the same host therefore
race for one port. The hosted workflow deliberately runs models sequentially;
local verification must do the same until `fmctl` can allocate and report an
isolated endpoint without weakening command reproducibility.

The pinned Apalache distribution also emits a legacy protobuf-generated-code
warning from its gRPC reflection service on current Java runtimes. Models and
adapter requests are trusted repository inputs, and this warning does not alter
TLC's checked graph, but it is a verifier supply-chain maintenance item—not a
warning to suppress or proof evidence to ignore. Upgrade Apalache/Quint when a
compatible pinned release removes it, then record the toolchain change in the
review evidence.

## Review rules

- A state-machine change must update its Quint model or explain in this ledger
  why it is outside the abstraction.
- New actions must be added to `required_actions`; adding an action that traces
  never exercise must fail CI. State-dependent branches that carry distinct
  safety behavior must also be required by every affected replay adapter.
- An adapter must call production APIs and compare observable behavior. A second
  implementation copied into the adapter is not refinement evidence.
- Safety and liveness claims must remain separate. Every liveness property must
  name the fairness assumption that makes it true.
- Counterexamples become permanent regression traces or fault tests before the
  fix is merged.
- Native/OS guarantees must be described as assumptions unless the platform
  supplies a stronger contract; background execution is generally best effort.
