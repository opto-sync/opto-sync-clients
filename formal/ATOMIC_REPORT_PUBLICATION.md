# Atomic formal report publication

The first DEN-1657 slice publishes one immutable, complete report directory from
an in-memory `CommandOutcome`. It does not update a mutable `latest` pointer or
wire every CLI/RPC path yet.

## Publication protocol

1. Validate a caller-supplied bundle identifier against a narrow ASCII grammar.
2. Canonicalize the publication root and reject symlinked or non-directory path
   components.
3. Acquire an immutable create-new reservation for the bundle identifier.
4. Render every byte payload before exposing a final directory.
5. Create a private, unique staging directory under the same filesystem root.
6. Write `result.json`, `junit.xml`, `sarif.json`, `artifacts.json`, and
   `provenance.json` with create-new semantics, bounded bytes, and per-file
   `sync_all`.
7. Sync the staging directory.
8. Rename the complete staging directory to its final immutable bundle name.
9. Sync the publication root where the platform supports directory fsync.
10. Retain the reservation so the bundle identifier cannot be reused.

Failures before the rename remove the staging directory and reservation. A
complete final directory is never modified in place.

## Public result envelope

The staged `result.json` is a content-free execution-evidence envelope, not a raw
serialization of `CommandOutcome`. It preserves operation identity, status,
exit/duration/truncation evidence, sanitized command identity, basenames of
artifacts, and the exact effective resource policy. It omits raw command
arguments, environment, stdout, stderr, failure text, adapter payloads, source,
trace contents, and absolute directory prefixes.

This separation is necessary because the internal outcome is useful for local
human diagnostics but is not a safe provenance artifact.

## Concurrency and recovery

A create-new reservation file serializes concurrent publication of the same
bundle identifier. Different identifiers may publish concurrently. A collision
is a hard error; the previous bundle remains unchanged.

Abandoned staging directories and orphan reservations can be removed by
`cleanup_stale_publication_state` after a caller-selected minimum age. Cleanup
never removes a reservation whose final bundle directory exists and ignores
foreign files.

## Checked boundaries

The core tests cover:

- complete five-file publication;
- deterministic bytes against the DEN-1637 renderers;
- same-ID immutability;
- concurrent same-ID publication with exactly one winner;
- failure injection after staged writes with no partial final bundle;
- stale staging/orphan-reservation cleanup;
- invalid identifiers;
- destination symlink rejection; and
- symlinked-root confinement on Unix.

## Remaining DEN-1657 integration

A follow-up must derive collision-safe bundle identities from verified input and
result hashes, publish from every CLI/RPC execution path, expose one stable
latest-complete reference, test crash points and Windows replacement semantics,
and reproduce report bytes from the retained public result schema.
