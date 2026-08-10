# Zed language-target packaging plan

The opto-sync engine is packaged first as `opto-sync/syncer`. This repository
currently publishes one whole-repository source package. A later package layout
may additionally publish isolated Zed packages for Node/browser, Dart, Rust,
and Gleam while retaining one coordinated release version.

## Why the root manifest has no language targets

Every current native manifest reaches a sibling checkout named `syncer.c`:

| Client | Native dependency |
|---|---|
| Node/browser | `file:../../../syncer.c/bindings/typescript` and `.../wasm` |
| Dart | `../../../syncer.c/bindings/dart` |
| Rust | `../../../syncer.c/bindings/rust` |
| Gleam | `../../../syncer.c/bindings/gleam` |

A Zed target contains only its declared target directory. Adding a root manifest
with `[targets.nodejs] dir = "clients/ts"` today would therefore produce a
package whose own `package.json` points outside the artifact. The same is true
for Dart, Rust, and Gleam. Passing `zed pack` is not enough; a clean consumer must
be able to resolve and build the native package after installation.

`scripts/check-zed-packaging.py` is a CI ratchet for this boundary. It verifies
the whole-repository source package and rejects language targets or redundant
Zed dependencies while required paths still resolve through the bundled,
pinned core. This prevents a well-intentioned manifest-only change from
publishing unusable slices or resolving two different core revisions.

## Target end state

After the engine dependency is relocatable, the root manifest may use one
release version and publish at least these additional target packages:

```toml
[package]
org = "opto-sync"
name = "opto-sync-clients"
version = "<coordinated release>"

[package.repository]
vcs = "git"
url = "https://github.com/opto-sync/opto-sync-clients"

[dependencies]
"opto-sync/syncer" = "^0.2"

[targets.repository]
dir = "."
name = "opto-sync-clients"

[targets.nodejs]
dir = "clients/ts"
name = "opto-sync-client-nodejs"
adapter = "node"

[targets.dart]
dir = "clients/dart"
name = "opto-sync-client-dart"

[targets.rust]
dir = "clients/rust"
name = "opto-sync-client-rust"

[targets.gleam]
dir = "clients/gleam"
name = "opto-sync-client-gleam"
```

The eventual pull request must also add a generated `.zpkg.lock`, run `zed r2g`
for every target, and prove each installed target with its native toolchain. It
must not rely on the author's sibling checkout or an uncommitted symlink.

## Compatibility constraints

Two known downstream repositories currently pin both repositories as sibling
git submodules:

- `sonus-auris/sonus-auris-sync`
- `voxletra/voxletra-sync`

A path-layout migration must include compatible downstream gitlink/build updates
and a clean-clone test in both consumers. The client and engine revisions should
be bumped together whenever their path or ABI contracts move in lockstep.
