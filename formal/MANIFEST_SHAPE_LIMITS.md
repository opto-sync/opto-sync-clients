# Formal manifest shape limits

The manifest byte ceiling prevents unbounded file allocation, but a compact TOML
file can still request pathological collection counts or carry unusually large
scalar values into plan construction, command assembly, and reports. The v1
loader therefore enforces the following deterministic shape limits before any
backend or adapter process starts.

| Field | Limit |
| --- | ---: |
| invariants | 256 |
| witnesses | 256 |
| adapters | 32 |
| trace required actions | 256 |
| adapter observable-state fields | 256 |
| adapter command arguments | 64 |
| adapter environment entries | 64 |
| labels | 128 bytes |
| identifiers | 128 bytes |
| toolchain version tokens | 256 bytes |
| executable/command arguments | 4,096 bytes |
| environment keys | 128 bytes |
| environment values | 4,096 bytes |

The constants live beside the manifest schema types in `tools/fmctl/src/manifest.rs`.
Validation reports every applicable error in deterministic field order. A value
at the exact boundary is accepted when it otherwise satisfies the existing
syntax and uniqueness rules; boundary plus one is rejected.

These are shape limits, not execution budgets. Timeouts, captured output,
simulation/verification/trace work, aggregate work estimates, local-versus-service
policy precedence, and requested-versus-effective provenance remain separate
DEN-1406 slices.
