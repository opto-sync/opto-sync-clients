# Local resource policy runtime enforcement

The merged manifest ceilings and `fm.resources.v1` resolver are effective only
when every command plan and process execution uses the resolved values. This
slice makes the local v1 profile mandatory for `fmctl` planning.

## Planning boundary

Before constructing Quint or adapter commands, `build_plan` derives one
`ResourceRequest` from the loaded manifest and resolves it through the local v1
profile. A resolution error returns before runtime directories are created or a
child process is launched.

`CommandPlan` records the complete `EffectiveResourcePolicy`. Effective values
control:

- process timeout;
- combined captured output;
- simulation samples and steps;
- configured verification steps;
- trace count, steps, and generator samples; and
- replay input file-size validation.

The trace-sample request preserves the existing fallback order: explicit trace
samples, then simulation samples, then the local profile default.

## Result boundary

`CommandOutcome` copies the exact plan policy. The ordinary result JSON therefore
contains profile/version identity, original requests, policy defaults/maxima,
effective values, inherited fields, and clamped fields without environment
values, source contents, or trace payloads.

## Compatibility and remaining work

This slice defaults all existing commands to local v1 and does not add a CLI/RPC
profile selector. CI/service selection, JUnit/SARIF properties, a separate
artifact manifest, and signed provenance remain DEN-1631 follow-ups. Batch and
streaming adapter protocols are unchanged.
