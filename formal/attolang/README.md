# AttoLang acknowledgment-correlation projection

This is a **source-only candidate** for the response-identity guard in the
client-owned [`opto_sync_protocol.qnt`](../opto_sync_protocol.qnt).
The Quint protocol state machine remains authoritative; this small model
isolates the acknowledge-after-commit boundary for future AttoLang refinement.

* A sent mutation has an immutable identity.
* The server may commit and lose its response.
* Stale/future responses cannot acknowledge the in-flight request.
* Duplicate replay never applies the same committed mutation twice.
* Client acknowledgement cannot exceed the server commit position.

Run `node formal/attolang/model-check.mjs` for finite exhaustive coverage,
including lost responses, replay, exhaustive response identities in [-1, 3],
accepted/rejected response witnesses, and three negative mutations:
precommit ACK, a stale response clearing a newer in-flight request,
and duplicate server effect application. Exact transition checks reject these
even when coarse watermark conservation happens to hold.
Bounds: two mutation identities and one in-flight mutation. The model does
**not** assert durability, atomic database commits, network fairness, or actual
client implementation refinement.

`ack_correlation.atto` and `expected.stdout` define a candidate guest
policy and expected output. They are **not** executed compiler evidence.
Before calling this AttoLang support verified, compile and execute the exact
source on Java/Graal, LLVM, .NET NativeAOT, Wasm, and Forge/Cranelift; replay
versioned protocol traces against the real TypeScript, Dart, Rust and AttoLang
implementations, with exact-head nonzero-step CI and adversarial negative tests.
Current guest parity: **NOT_EXECUTED**.
