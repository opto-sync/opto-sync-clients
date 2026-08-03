# Streaming protocol fixtures

The JSON-lines transcripts in this directory are shared semantic test vectors for
`fm.adapter.stream.v1`. They are not product-model traces.

`capabilities.v1.json` is the authoritative ordered capability registry. Every
streaming SDK must compare its local registry and mandatory set directly with
that file. A valid hello capability array is a strict subsequence of the registry
that contains `reset`, `apply`, `observe`, and `close`.

Positive transcripts under `valid/` must complete successfully. Negative
transcripts under `invalid/` must fail at the named semantic boundary. In
particular, capability arrays with duplicates, missing required operations,
`hello`, unknown operations, or noncanonical ordering must be rejected without
consuming pending correlation state.
