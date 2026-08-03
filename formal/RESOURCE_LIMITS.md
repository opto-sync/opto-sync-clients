# Formal-methods resource limits

The `fmctl` manifest is executable-work configuration and is treated as an
untrusted input boundary even for local runs.

## Manifest input

`formal/fm.toml` and an explicitly selected manifest path are limited to 1 MiB.
The loader:

1. canonicalizes the path inside the workspace;
2. requires a regular file;
3. checks metadata size before allocating the file body;
4. reads bytes rather than an unbounded UTF-8 string;
5. checks the actual byte count again after reading, closing a growth race; and
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
