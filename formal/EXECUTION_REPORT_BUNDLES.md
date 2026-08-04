# Execution report bundles

Every non-dry-run `check`, `simulate`, `verify`, `trace`, and `replay` operation
uses one library path that returns:

```text
PublishedExecution {
  outcome,
  bundle,
}
```

The CLI JSON representation and JSON-RPC `kind: execution` response serialize
that same structure. Human CLI output preserves verifier stdout/stderr and adds
the complete immutable bundle directory.

Bundles are published below:

```text
<execution.artifacts_dir>/bundles/<operation>-<sha256>/
```

The SHA-256 identity is computed from length-prefixed JUnit, SARIF, artifact
manifest, and provenance bytes rendered from the exact in-memory outcome. Those
surfaces deliberately exclude raw arguments, environment, stdout/stderr,
source, and trace payloads.

Planning, validation, init, doctor, shutdown, and all `--dry-run` paths do not
publish execution reports.

A publisher/path/fsync failure is classified as `ReportPublication` with stable
exit code 6. It is distinct from model failure, timeout, adapter mismatch, and
process-supervision failure. The ordinary result artifact may already exist when
publication fails; callers must not treat it as a complete report bundle.

The bundle publisher remains immutable. Reusing an existing bundle id is
fail-closed; later content-addressed deduplication may verify and reuse an exact
complete bundle, but must never overwrite it in place.
