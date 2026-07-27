# Zed packaging

`opto-sync-clients` is packaged first as the whole-repository Zed source package
`opto-sync/opto-sync-clients@0.2.0`. It is prepared for publication; do not claim
a registry release until the dependency is resolved into the lockfile and the
matching Git tag has been reviewed.

The manifest records `opto-sync/syncer = ^0.2.1` so the reconciliation engine
relationship is part of the package graph rather than tribal knowledge. The
current `.zpkg.lock` contains only `version = 1`: it is a format-valid placeholder,
not a frozen dependency resolution, until `opto-sync/syncer@0.2.1` is available
from the configured registry and `zed install` writes its artifact hash, size,
tag, commit, and source.

## Current package boundary

The whole-repository artifact is useful as a reproducible source bundle, but the
native client manifests still expect a sibling Git checkout named `syncer.c`.
Installing the Zed dependency as `opto-sync/syncer` does not by itself rewrite
those ecosystem-native paths or create a `syncer.c` alias. Native builds must
therefore continue to use the documented sibling checkout until that path
contract is migrated.

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

1. publish the relevant engine binding as an independent native package and use
   that ecosystem's normal dependency syntax;
2. vendor the minimal C core into the language package with an automated,
   hash-checked generation step; or
3. teach the native manifest to resolve the separately installed Zed dependency
   without embedding machine-specific absolute paths.

After that, add one root target per language using the names
`opto-sync-client-nodejs`, `opto-sync-client-dart`, `opto-sync-client-rust`, and
`opto-sync-client-gleam`. The same pull request must generate the real lockfile
and run an installed-artifact test for every target.

## Validation and release

The normal client CI remains authoritative for runtime behavior across Node,
real Chromium IndexedDB/WASM, Dart SQLite/FFI, Rust SQLite, and Gleam/BEAM. It
uses an immutable compatible engine commit by default, removes checkout tokens
before executing build code, and installs Node dependencies through committed
locks. Manual dispatch can test a candidate engine ref explicitly.

`scripts/check-zed-packaging.py` validates the root package identity, dependency,
license, lockfile format, and every native path. It permits the current
whole-repository source package but rejects `[targets]` while any required engine
path escapes a target artifact. The Zed workflow runs the same check against
both the worktree and the extracted tarball, inspects the archive for required
manifests and forbidden build/cache directories, performs a non-mutating publish
dry run, and uploads the deterministic artifact.

```sh
python3 scripts/check-zed-packaging.py
zed pack
zed publish --dry-run
# after opto-sync/syncer@0.2.1 exists in the registry:
zed install
# review and commit the populated .zpkg.lock, tag the exact commit, then:
zed publish
```
