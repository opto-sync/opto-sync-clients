# Experimental Oreslang Opto Sync admission slice

**Status: not an SDK, not publishable, not multi-backend certified.**
This source is deliberately outside `clients/` and the canonical `clients/client-contract-matrix.json`. It does not modify TypeSpec/JSON Schema authorities, generated schemas, `syncer.c`, or product wire contracts. Existing Oreslang staging negative tests must remain fail-closed.

## Included
- `src/sync_admission.ores`: native Oreslang *scalar* guards for durable checkpoint bounds, generation equality and single retry deadline.
- `tests/sync_admission_contract.ores`: 16 positive/negative guest assertions; exits 0 only if native compiler/runtime execute the expected decisions.
- `fixtures/*.ores`: three one-function i64 positive and two negative compiler tests in the smallest shared Java/LLVM/Wasm/Forge/.NET grammar. These are compiler smoke tests, **not** a sync SDK.
- `scripts/run-oreslang-parity.mjs`: opt-in strict toolchain receipt validator. Tests its evidence-denial logic using `node --test experimental/oreslang/tests/host-admission.test.mjs` (Node 22+). This Node suite is host-only and cannot certify Oreslang.

## Backend admission tracks
1. **Java/GraalVM**: compile and run the actual `src` + `tests` guest program, then JS transpilation separately through an authenticated/pinned compiler.
2. **LLVM**: compile, link, execute `tests/sync_admission_contract.ores` and scalar fixtures; run ASan/UBSan for native runtime contracts. No JS output is implied.
3. **Wasm**: compile with the real pinned Oreslang LLVM frontend/bridge and run in a restricted guest host; record wasm binary SHA and deny imports. A Rust-produced Wasm artifact is not an Oreslang pass.
4. **Forge/Cranelift**: distinguish the independent OresForge interpreter/native pipeline from any separately verified Cranelift lowering. At present only the scalar compiler smoke suite is in scope.
5. **.NET Native AOT**: use the compiled Oreslang scalar `main` fixtures in Native AOT; the richer module contract is **blocked** until shipping structured functions, bools and imports exist. Never call CIL-only execution Native AOT.
6. **JS**: run **transpiled Oreslang** output in Node and an isolated browser harness; compare with Wasm, do not substitute handwritten TypeScript.

The toolchain drivers must be reviewed pinned executables (one per backend), each compiling the *actual source*. Each driver config must include absolute `binary`, `compiler`, `runtime`, their three SHA-256 pins (`sha256`, `compilerSha256`, `runtimeSha256`), and argument tokens `{source}` and `{artifact}`. The driver must write the compiled artifact to the supplied isolated `{artifact}` path for successful cases and must not create it for rejected cases. The harness independently hashes the output artifact and verifies that negative tests publish nothing. Each driver reports a bounded JSON receipt with `backend` (must match the requested lane), `sourceSha256`, `driverSha256`, `compilerSha256`, `runtimeSha256`, `artifactSha256`, `kind` (`value` or `reject`) and `value` for positives. For rejected cases `artifactSha256` must be null. On negatives, drivers must prove compile rejection **and no artifact publication**; the receipt is insufficient by itself without linked stepful logs. The validator requires every declared driver and all five scalar fixtures, verifies local driver/source digests and rejects missing/mismatched receipts. A green host-only validator is never compiler evidence.

## Promotion blockers

Do **not** add `oreslang` to SDK matrices, shipping manifests, or release packages until real Oreslang guest runs are green, TypeSpec and independently authored JSON Schema Draft 2020-12 are compiler-compared in TJSV, exact source and Contract IR digests match, and the SDK implements full contract behavior (IDs, durable queue, idempotent ACKs, cancellation, transport and native core reconciliation). Bind a reviewed immutable compiler SHA for **each** backend; require positive/negative test cases, malformed payloads, security and replay tests, JS and Wasm browser tests, a clean Zed consumer install, and artifact/package integrity. No default-success, skip-as-pass or zero-step evidence.

Run host tests: `node --test experimental/oreslang/tests/host-admission.test.mjs`.
Run configured real toolchains only after drivers have been built and peer-reviewed: `node scripts/run-oreslang-parity.mjs /absolute/drivers.json`.

## Java/GraalVM + LLVM first compiler stage (NOT full parity)

The existing all-six driver entrypoint remains strict. To execute just the
**first two** compiler/guest lanes with the **same** hash-pinned snapshot,
compiler exit, guest exit, positive/negative fixture and artifact enforcement:

```sh
node scripts/run-oreslang-parity.mjs --stage-java-llvm /absolute/reviewed-java-llvm-drivers.json
```

The JSON must contain `schemaVersion: 1` and **exactly** `java` and `llvm`
drivers, using the same absolute `binary`, `compiler`, `runtime`, SHA-256
pins and `args` token rules as the six-lane mode. Each backend runs all five
scalar fixtures (10 expected driver receipts). No missing, extra, fake backend,
invalid compiler/guest exit, symlink output, or artifact from rejected source
can be admitted. Any driver failure exits nonzero; no skip is counted as pass.
A strict six-backend run **rejects** this two-driver configuration.

This stage proves **only reported scalar compiler/guest fixture behavior** when
actually run against reviewed, pinned *real* AttoLang toolchains with independent
stepful logs. Host synthetic tests prove the gate's rejection behavior only.
Passing two-lane receipts is **not** full backend parity, not an actor/HTTP SDK,
not NativeAOT or GraalVM AOT unless separately evidenced, and not an AttoLang
product support or release claim. Until real pinned compiler inputs are supplied
and this command executes, real Java/LLVM AttoLang guest evidence is
**NOT_EXECUTED**. Never silently substitute a JS/Rust implementation.

## Canonical scalar grammar and compile-negative contract (2026-11-10)

The five scalar smoke fixtures use `pub fnc main(): int`, the existing
executable common-subset declaration spelling in both Java and LLVM
`contracts/v1/fixtures/literal-42.ores` sources. The original speculative
`define pub fnc` spelling is no longer used by these strict smoke cases.

`reject-overflow` is an **out-of-range signed-i64 integer literal**
(`9223372036854775808`), which both canonical compiler scalar suites
already classify as a compile-time rejection. It is **not** a claim
that the in-range expression `MAX_I64 + 1` must be compile-rejected:
checked arithmetic can trap during guest execution and requires a
separate explicit runtime-overflow contract and real compiler evidence.

Companion exact-byte source PRs: Java
[oreslang-source.java#2751](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2751),
LLVM [oreslang-source.llvm#1639](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1639).
All three repositories must keep all five Git blob SHAs identical at their
**current exact PR heads**. Neither the host synthetic checks nor a no-runner
source-org Actions failure is actual AttoLang guest proof.
