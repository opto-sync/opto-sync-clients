# Oreslang client conformance candidate

**Draft-only, no supported language claim.**

Source repository: `opto-sync/opto-sync-clients`
Existing relevant roots: `clients/`, `contract/`, `contract-admission/`, `schemas/`.

The Oreslang implementation should preserve Opto Sync merge protocol, identity, payload sync ordering and native connectivity.

## Must implement before promotion

- Reuse the *independently authored* TypeSpec and JSON Schema Draft 2020-12
  peer authority pair owned by the corresponding interfaces repository;
  never promote generated declarations or TypeSpec-derived JSON Schema to
  an authored authority. Resolve semantic disagreements explicitly.
- Pin source/contract revision, produce a fresh ORESoftware/TJSV current-input
  parity receipt and Contract IR identity; require persistence convergence
  via ORESoftware/ores-contracts **only** for persistence-bearing families.
- Create the actual Oreslang JVM/GraalVM adapter with compiler tests. For
  clients, consume the proposed ORESoftware/ores-clients-core renderer;
  implement real operations and exact wire serialization, not stub success.
- Differentially run reviewed valid and invalid fixtures against existing
  language peers; test null/absence, enum tags, integer bounds, malformed
  payloads, error codes, cancellation and concurrent state races.
- Emit TJSV language/runtime and positive/negative per-case evidence with
  exact-head SHA, source closure, fixture input digests, compiler/toolchain
  and ingress/egress outcomes. Missing steps, missing evidence, stale pins,
  or failed native tests must block support.
- Keep JS/browser and Wasm/browser **future** runtime tracks separately
  verified, including restricted capabilities (no inherited Java host access).
- Update existing `governance/`, conformance participant and publication
  registries only together with working Oreslang adapter + mandatory CI.

A declaration-only or documentation-only result is not conformance; this is
a proposal for the executable implementation and test gates.
