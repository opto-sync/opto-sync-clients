# Formal-methods resource limits

The `fmctl` manifest is executable-work configuration and is treated as an
untrusted input boundary even for local runs.

## Manifest input

`formal/fm.toml` and an explicitly selected manifest path are limited to 1 MiB.
The loader:

1. canonicalizes the path inside the workspace;
2. opens the canonical path and requires that exact handle to be a regular file;
3. checks metadata from the opened handle before allocating the file body;
4. reads that same handle up to the ceiling plus one sentinel byte;
5. checks the actual byte count again after the capped read, detecting growth without unbounded allocation; and
6. validates UTF-8 before TOML parsing.

Oversized, non-file, or invalid-UTF-8 inputs are manifest-validation failures and
exit through the deterministic configuration-error path rather than reaching the
TOML parser or verifier backend.

## Remaining DEN-1406 profiles

This first slice does not choose final execution ceilings. Follow-up slices must
add named local and service profiles for timeout, captured output, simulation,
verification, trace generation, collection cardinality, string sizes, aggregate
work estimates, and requested-versus-effective provenance. A service policy may
lower a manifest request but must never let the manifest raise the service's
limits.
