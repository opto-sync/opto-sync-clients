# Experimental AttoLang sync actor transition kernel

**Status: source candidate, NOT_EXECUTED, NOT a usable actor/HTTP client.**
This is a new, isolated layer under `experimental/oreslang/`. It does not
touch shipping SDK packages, schema authorities, TypeSpec, C syncer or the
six-backend admission manifest.

## Ownership and protocol invariants

`src/sync_actor_policy.ores` describes the deterministic gates; the
`src/durable_sync_actor.ores` candidate owns a sealed `state {}` container
and mutates it only inside `handle_state(critical-write |s| -> {...})`.
All APIs/methods use snake_case. It never awaits while holding a state loan.

The phase transition is:

```text
[0 Idle] --reserve_mutation--> [1 AwaitStageFsync]
[1] --verified local journal fsync+rename+dir fsync--> [2 Ready]
[2] --begin_dispatch with original deadline--> [3 Inflight]
[3] --timeout / lost response--> [2 Ready: SAME mutation ID]
[3] --verified scoped SERVER-DURABLE ACK--> [4 AwaitRetireFsync]
[4] --verified local journal retire fsync--> [0 Idle, last_ack advanced]
```

**Strict safety rules:** phase 1 cannot send; phase 4 cannot erase pending
until the local retirement is durable; no generated retry mutation identity;
no deadline reset; no stale-generation/tenant/client/mutation ACK; check i64
bounds before computing last_ack + 1; one mutation outstanding per actor.

## Not-yet-implemented trusted boundary (hard blocker)

This candidate does **not** implement local SQLite/file persistence,
`fsync`, HTTP, the persistence adapter, supervisor restore, or capability
authentication. The transition methods `note_*` and `begin_dispatch` are
non-public but their arguments are **not themselves** authenticated proofs.
No untrusted caller may directly invoke them. Implement a typed, unforgeable
journal-commit receipt and a verified transport-response capability, then
invoke each private transition only from a serialized actor mailbox turn
*after* the real operation completes. A boolean `storage_fsynced` by itself
MUST NOT be trusted. A post-crash supervisor must reload a verified durable
journal, choose a new generation under persistent fencing, and replay the
same `mutation_id` if retirement was not durably recorded. A crash during
phase 1 may only recover an actually durable stage.

`tests/sync_actor_policy_contract.ores` is a **real AttoLang source fixture**
for eventual compiler execution. Expected guest exit: 0. It does not pass
until the Java/GraalVM and LLVM compiler jobs execute stepfully at exact SHA.
`tests/sync-actor-model.host.test.mjs` is an **independent Node host model**:
it tests crash windows and forged acknowledgments but does NOT execute
AttoLang source and cannot certify actor, runtime, persistence or network.

## Promotion gates

1. Actual Java + LLVM guest scalar suite (3 positive + 2 negative per lane)
   at exact SHA, with real executable and job-step receipts.
2. Compile and execute `sync_actor_policy_contract.ores` on each backend;
   parse/type-check the actual actor source and enforce sealed state.
3. Build a vetted journal adapter (fsync+rename+dir fsync or SQLite WAL with
   durable commit) and typed receipts; no external calls while state loan held.
4. Implement supervisor recovery, process generation fencing and a native
   HTTP client. Execute two-process crash-before-send, response-loss, crash-
   after-ACK-before-retire, forged-ACK, stale-writer and duplicate-ACK cases.
5. Compare against existing `opto-sync/opto-sync-e2e` PR #70 PostgreSQL
   reference oracle. Do not promote host-only or zero-runner steps.

## Exact proposed AttoLang source identity

`actor-source-pins.v1.json` pins the three AttoLang candidate source Git
blob identities. The host CI checks their exact bytes before any model tests.
This is file-identity evidence only; it does not assert successful parsing,
compilation or guest execution. An authorized real compiler acceptance run
must separately bind the exact PR head and root Git tree and preserve the
stepful compiler and guest results.
