# Oreslang target: contract and runtime admission (draft)

**No active SDK / no compiler or runtime conformance yet.** This is a scoped target proposal, not a green runtime or release declaration.

Role: clients. Peer contract owner: [opto-sync/opto-sync-interfaces](https://github.com/opto-sync/opto-sync-interfaces); authority inventory: `contract/, contracts/, schemas/, clients/`.

Repository-specific compatibility requirement: A Zed package used by downstream sync repos; breaking changes require semver and pinned consumer tests; do not alter merge/conflict semantics.

## Non-negotiable gates

1. Check the exact independent human-authored TypeSpec + JSON Schema Draft 2020-12 product source pairs at immutable reviewed refs. No generated schema outranks either human-authored authority, no product-wide certification from a narrow parity canary.
2. Use reviewed [TJSV](https://github.com/ORESoftware/typespec-json-schema-validator) to establish parity and source-current Contract IR/receipt identity, with positive/negative instances and a qualified declaration inventory. Invoke [ores-contracts](https://github.com/ORESoftware/ores-contracts) additionally only for applicable persistence semantics.
3. Create implementation-native Oreslang package/declaration code, not a copied authority: [Oreslang Java/GraalVM](https://github.com/ores-truffle-oreslang/oreslang-source.java) compiler and [serialization/validation](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation) must compile and execute. Stub runners, unmerged compiler features, or unavailable toolchains mean **blocked**.
4. Exercise exact wire names, enum/discriminant values, missing/nullable/unknown properties, integer/byte limits, error semantics, malformed inputs, boundary/replay state traces; preserve this repository's security invariants.
5. Return only bounded payload-free per-fixture verdicts with the exact Contract IR ID, TJSV parity ID, fixture digest, source/implementation/compiler SHA. TJSV is the final runtime admission authority. Require consumer import tests, Zed package integrity and fail-closed negative tests before release.
6. JS-transpiled and Wasm/browser Oreslang are future **independent** compilation and hermetic browser test targets. Existing TypeScript or Rust-Wasm success cannot certify Oreslang.

## Evidence needed

- [ ] Both independent authored authorities and complete declaration scope reviewed
- [ ] TJSV current-input parity plus bound Contract IR receipt
- [ ] Real Oreslang compiler, fixture, and negative-conformance passes
- [ ] External consumer/package tests and exact compiler/runtime pins

No source-contract or generated-file modifications in this draft; all evidence remains pending.
