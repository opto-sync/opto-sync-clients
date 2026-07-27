# Zed packaging

`opto-sync-clients` is packaged first as the whole-repository Zed source package
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
its own `Cargo.toml`. Zed would correctly produce an archive, but the archive
would not be a usable Rust package. The root manifest intentionally has no
`[targets]` block until this is fixed.

`scripts/check-zed-packaging.py` validates this boundary in both the source
worktree and the extracted Zed artifact. It verifies the package identity,
engine range, repository license, source lockfile, native dependency paths, and
absence of unsafe language targets.

## Path to language packages

A language target is ready only when a clean-room consumer can build it with no
sibling Git checkout. Acceptable designs include:

1. publish the relevant `syncer.c` binding as an independent native package and
   use that ecosystem's normal dependency syntax;
2. vendor the minimal C core into the language package with an automated,
   hash-checked generation step; or
3. teach the native manifest to resolve the separately installed Zed dependency
   without embedding machine-specific absolute paths.

After that, add one root target per language using names such as
`opto-sync-client-nodejs`, `opto-sync-client-dart`,
`opto-sync-client-rust`, and `opto-sync-client-gleam`. Each target must pass an
installed-artifact test with its own native toolchain.

## Reproducible client CI

Ordinary Node, Dart, Rust, and Gleam CI pins the exact audited `syncer.c` commit
`f6a56d070779404acf188ffac766e39741a15466`. Historical reruns therefore test
the same engine instead of silently following mutable `main`. A manual workflow
dispatch can deliberately override the pin with `main`, a branch, or a candidate
SHA for forward-compatibility testing.

Every checkout disables persisted credentials before package-manager, compiler,
or test code executes. Node installs use committed lockfiles through `npm ci`,
and native build outputs are never restored from cross-revision caches.

## Package validation

The client runtime CI remains authoritative for behavior across Node, real
Chromium IndexedDB/WASM, Dart SQLite/FFI, Rust SQLite, and Gleam/BEAM. The
additional `Zed package contract` workflow:

1. builds pinned Zed tooling with checkout credentials disabled;
2. validates the source package boundary;
3. packs twice and requires byte-identical archives;
4. performs a non-mutating publish dry run;
5. inspects the exact tarball for the license and all four native manifests;
6. rejects dependency/cache/build trees in the artifact; and
7. extracts the package and reruns the boundary validator against installed
   bytes rather than the source checkout.

## Registry publication

`.github/workflows/zed-publish.yml` dry-runs on every relevant pull request and
performs a real upload only from a selected or pushed `v*` tag. It fetches full
tag history for provenance, disables persisted checkout credentials, builds
pinned Zed tooling, rejects branch publication, and reads registry authority
only from the repository secret `ZED_PKG_TOKEN`.

Release order matters. Publish `opto-sync/syncer@0.2.1` first; then provision the
`opto-sync` registry namespace and this repository's `ZED_PKG_TOKEN`, place
`v0.2.0` on the reviewed `main` commit, and let the tag workflow publish
`opto-sync/opto-sync-clients@0.2.0`. After the registry resolves the dependency,
run `zed install` and commit the resulting non-empty `.zpkg.lock` with exact
artifact hashes.

Two confirmed downstream consumers pin `syncer.c` and `opto-sync-clients` as
sibling git submodules: `sonus-auris/sonus-auris-sync` under `third_party/` and
`voxletra/voxletra-sync` under `vendor/`. A native path or ABI migration must
update and clean-clone test both gitlinks as a certified pair.

Manual preflight:

```sh
python3 scripts/check-zed-packaging.py
zed pack
zed publish --dry-run
```

A green package dry run means the artifact is reproducible and uploadable. It
does not by itself mean the package is already present in the registry.
