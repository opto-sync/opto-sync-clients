# Formal-methods resource policy and provenance v1

The bounded manifest defines what a repository may request. An active execution
profile defines what the current environment permits. Every operation must
record both inputs and the resulting effective limits.

## Profiles

The Rust contract in `tools/fmctl/src/resource.rs` defines three named profiles:

- **local** — repository maximums; an over-policy request is rejected;
- **ci** — lower shared-runner limits; independent scalar overages are clamped
  and recorded; and
- **service** — the strictest initial multi-tenant precursor; independent scalar
  overages are clamped and recorded.

Each profile has a version, defaults, scalar maximums, and aggregate simulation
and trace-work ceilings. Missing request fields inherit the named defaults and
are listed in `inherited_fields`. Clamped fields are listed in deterministic
field order in `clamped_fields`.

## Coupled work

Simulation samples × steps, trace count × steps, and trace samples × steps are
coupled budgets. The resolver never silently changes one dimension to make a
product fit. A product above policy—or an arithmetic overflow—is rejected even
for a clamping profile. This avoids hidden changes to model coverage.

## Provenance envelope

`EffectiveResourcePolicy` serializes:

- schema and policy versions;
- profile and overage behavior;
- the original optional request;
- policy defaults and maximums;
- effective scalar limits and checked work products;
- inherited fields; and
- clamped fields.

The structure contains numeric policy data only. It has no environment values,
credentials, source contents, or trace payloads. Stable JSON ordering is tested.

## Current slice and follow-up

This PR establishes the versioned resolver contract and drift tests against the
local manifest constants. A follow-up must wire the resolved envelope into
`CommandPlan`, JSON results, JUnit/SARIF properties, artifact manifests, and
provenance before DEN-1628 is complete. DEN-582 remains blocked until service
policy and sandbox/tenant isolation are both enforced by the actual runner.
