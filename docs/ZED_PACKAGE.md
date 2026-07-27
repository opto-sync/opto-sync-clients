# Zed packaging

`opto-sync-clients` is published first as the whole-repository Zed package
`opto-sync/opto-sync-clients@0.2.0`.

The package records `opto-sync/syncer = ^0.2.1` as its Zed dependency so the
reconciliation engine relationship is part of the package graph and eventual
lockfile rather than tribal knowledge.

## Why this is not fanned out by language yet

The repository is structurally polyglot, but the unit of publication must also
be a unit that can build after installation. Today all four native manifests
reach outside their language root:

- TypeScript: `clients/ts/package.json` references `../../../syncer.c/...`.
- Dart: `clients/dart/pubspec.yaml` references `../../../syncer.c/...`.
- Rust: `clients/rust/Cargo.toml` references `../../../syncer.c/...`.
- Gleam: `clients/gleam/gleam.toml` references `../../../syncer.c/...`.

A target such as `dir = "clients/rust"` would therefore omit files required by
its own `Cargo.toml`. Zed would correctly produce a deterministic archive, but
the archive would not be a usable Rust package. The root manifest intentionally
has no `[targets]` block until this is fixed.

## Path to language packages

A language target is ready only when a clean-room consumer can build it with no
sibling Git checkout. Acceptable designs include:

1. publish the relevant `syncer.c` binding as an independent native package and
   use that ecosystem's normal dependency syntax;
2. vendor the minimal C core into the language package with an automated,
   hash-checked generation step; or
3. teach the native manifest to resolve the separately installed Zed dependency
   without embedding machine-specific absolute paths.

After that, add one root target per language using the names
`opto-sync-clients-nodejs`, `opto-sync-clients-dart`,
`opto-sync-clients-rust`, and `opto-sync-clients-gleam`. The Zed package
workflow contains assertions for the current sibling paths; changing those
assertions is part of the language-slice review.

## Validation and release

The existing client CI remains authoritative for runtime behavior across Node,
real Chromium IndexedDB/WASM, Dart SQLite/FFI, Rust SQLite, and Gleam/BEAM. The
additional `Zed package contract` workflow builds pinned revisions of the Zed
CLI and interfaces, validates the path boundary, runs `zed pack`, performs a
non-mutating `zed publish --dry-run`, and uploads the artifact.

```sh
zed pack
zed publish --dry-run
# after opto-sync/syncer@0.2.1 exists, the lockfile is generated, and v0.2.0
# points at the reviewed commit:
zed install
zed publish
```
