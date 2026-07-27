# Zed packaging

`opto-sync-clients` is published first as the whole-repository Zed source package
`opto-sync/opto-sync-clients@0.2.0`.

The package records `opto-sync/syncer = ^0.2.1` as its Zed dependency so the
reconciliation-engine relationship is part of the package graph and eventual
lockfile rather than tribal knowledge.

## Current package boundary

The repository is structurally polyglot, but a language target must also build
from a clean installed artifact. Today all four native manifests reach a sibling
checkout named `syncer.c`:

- TypeScript: `clients/ts/package.json` references `../../../syncer.c/...`.
- Dart: `clients/dart/pubspec.yaml` references `../../../syncer.c/...`.
- Rust: `clients/rust/Cargo.toml` references `../../../syncer.c/...`.
- Gleam: `clients/gleam/gleam.toml` references `../../../syncer.c/...`.

The root package is therefore a coordinated **source package**, not a claim that
each native client can already be lifted out and built alone. A target such as
`dir = "clients/rust"` would omit files required by its own `Cargo.toml`. Zed
could produce an archive, but the installed Rust package would be unusable.

`scripts/check-zed-packaging.py` protects that distinction. It validates the
root package identity, engine dependency, lockfile format, and current binding
paths. It permits the whole-repository source package and rejects any non-root
target whose native dependencies escape the target artifact.

## Path to language packages

A language target is ready only when a clean-room consumer can install and build
it with no sibling Git checkout. Acceptable designs include:

1. publish the relevant `syncer.c` binding through the language ecosystem and
   use normal package dependency syntax;
2. vendor the minimum C core into the language package through an automated,
   hash-checked generation step; or
3. materialize the separately installed Zed dependency into a stable relative
   path understood by the native manifest, without machine-specific paths.

After that, add one root target per language using names such as
`opto-sync-client-nodejs`, `opto-sync-client-dart`,
`opto-sync-client-rust`, and `opto-sync-client-gleam`. Each target must pass an
installed-artifact test with its native toolchain before it is published.

## Reproducible client validation

Ordinary client CI pins a known-compatible immutable `syncer.c` commit. This
makes a historical client commit test the same engine every time rather than
following a moving `main` branch. A manual workflow dispatch may intentionally
override the pin with `main`, a candidate branch, or an exact SHA for forward-
compatibility testing.

The workflow also:

- disables persisted checkout credentials before dependency/build scripts run;
- uses committed Node lockfiles through `npm ci`;
- caches only downloaded Rust dependencies, never native build output; and
- runs the Zed packaging guard independently of the four runtime jobs.

## Downstream gitlink compatibility

Two confirmed consumers pin `syncer.c` and `opto-sync-clients` as sibling Git
submodules:

- `sonus-auris/sonus-auris-sync` under `third_party/`;
- `voxletra/voxletra-sync` under `vendor/`.

A native path-layout or ABI migration must update both gitlinks to a certified
pair and run each downstream suite from a clean clone with initialized
submodules. Updating only one gitlink can produce an apparently clean revision
that cannot build or that combines incompatible semantics.

## Validation and release

The existing client CI remains authoritative for runtime behavior across Node,
real Chromium IndexedDB/WASM, Dart SQLite/FFI, Rust SQLite, and Gleam/BEAM. The
additional Zed package workflow builds pinned revisions of the Zed CLI and
interfaces, validates the package boundary, runs `zed pack`, performs a
non-mutating `zed publish --dry-run`, and uploads the artifact.

```sh
python3 scripts/check-zed-packaging.py
zed pack
zed publish --dry-run
# after opto-sync/syncer@0.2.1 exists, the lockfile is generated, and v0.2.0
# points at the reviewed commit:
zed install
zed publish
```
