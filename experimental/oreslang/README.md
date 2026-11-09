# Experimental AttoLang (legacy Oreslang) Opto Sync admission slice

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

The toolchain drivers must be reviewed pinned executables (one per backend), each compiling the *actual source*. Each driver config must include absolute `binary`, `compiler`, `runtime`, their three SHA-256 pins (`sha256`, `compilerSha256`, `runtimeSha256`), and argument tokens `{source}`, `{artifact}`, `{compiler}`, and `{runtime}`. `{case}` may be used to identify the exact fixture. The driver must write the compiled artifact to the supplied isolated `{artifact}` path for successful cases and must not create it for rejected cases. The harness independently hashes the output artifact and verifies that negative tests publish nothing. Each driver reports a bounded JSON receipt with `backend` (must match the requested lane), `sourceSha256`, `driverSha256`, `compilerSha256`, `runtimeSha256`, `artifactSha256`, `kind` (`value` or `reject`) and `value`, `compilerExitCode: 0`, and `guestExitCode` equal to the expected native result for positives. Negative receipts require a nonzero `compilerExitCode` and must omit `guestExitCode`. The host harness snapshots the pinned source, driver, compiler, and runtime into isolated temporary files before starting the reviewed driver; this reduces provenance time-of-check/time-of-use exposure. Synthetic receipts do not prove a compiler was invoked, so independent stepful compiler and guest execution remains mandatory. For rejected cases `artifactSha256` must be null. On negatives, drivers must prove compile rejection **and no artifact publication**; the receipt is insufficient by itself without linked stepful logs. The validator requires every declared driver and all five scalar fixtures, verifies local driver/source digests and rejects missing/mismatched receipts. A green host-only validator is never compiler evidence.

## Promotion blockers

Do **not** add `oreslang` to SDK matrices, shipping manifests, or release packages until real Oreslang guest runs are green, TypeSpec and independently authored JSON Schema Draft 2020-12 are compiler-compared in TJSV, exact source and Contract IR digests match, and the SDK implements full contract behavior (IDs, durable queue, idempotent ACKs, cancellation, transport and native core reconciliation). Bind a reviewed immutable compiler SHA for **each** backend; require positive/negative test cases, malformed payloads, security and replay tests, JS and Wasm browser tests, a clean Zed consumer install, and artifact/package integrity. No default-success, skip-as-pass or zero-step evidence.

Run all synthetic host-only security tests: `node --test experimental/oreslang/tests/*.test.mjs`.
Run configured real toolchains only after drivers have been built and peer-reviewed: `node scripts/run-oreslang-parity.mjs /absolute/drivers.json`.

## Independent native LLVM scalar proof (NOT_EXECUTED)

The draft [AttoLang LLVM Opto Sync PR #1621](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1621) adds seven source-pinned native `.atto` fixtures: five checkpoint/generation/deadline/ACK/tenant-cursor guards and two compiler-negative cases. Its LLVM/Clang O0/O2 workflow resides in the actual compiler repo; it does not bypass private source boundaries or introduce an Opto Sync SDK. Exact source head: `b93dbef076d583101b527e376bb88fa8c0e87cba`.

[Native guest run #42556978496](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/42556978496) failed before any job steps executed. LLVM compiler/guest execution remains **NOT_EXECUTED / NOT_CERTIFIED**. A new run on an approved source-side runner must actually build the compiler, execute native O0/O2 guests and reject invalid sources. The host-only checks in this PR cannot certify backend parity.
