# Zed language-target packaging boundary

The opto-sync engine is packaged first as `opto-sync/syncer`. This repository
currently publishes one whole-repository source package. It also stages
publication-disabled, self-contained language targets for Node/browser, Rust,
Dart/Flutter, and Gleam/BEAM while retaining one coordinated release identity.

## Why the root manifest has no language targets

Every current native manifest reaches a sibling checkout named `syncer.c`:

| Client | Native dependency |
|---|---|
| Node/browser | `file:../../../syncer.c/bindings/typescript` and `.../wasm` |
| Dart | `../../../syncer.c/bindings/dart` |
| Rust | `../../../syncer.c/bindings/rust` |
| Gleam | `../../../syncer.c/bindings/gleam` |

Copying one target directory by itself would produce a package whose native
manifest points outside that copy. The same is true for Dart, Rust, and Gleam.
The root manifest therefore exposes only `[targets.repository]`: the 30
runtime entries in `clients/contract-manifest.json` are API/conformance targets,
not independently publishable archives. Passing `zed pack` is not enough; a
clean local registry and install must retain the one bundled core.

The staging scripts solve the artifact boundary without pretending the registry
contract is ready. Each one assembles only the selected client, the required
binding surface, the pinned `syncer.c` source, and the shared fixtures in a
temporary source root. The generated `release-set.json` records exact commits
and manifest/lock digests and keeps `publicationEnabled` false. See
`docs/DART_ZED_TARGET.md` and `docs/GLEAM_ZED_TARGET.md` for the native, browser,
Flutter, and BEAM acceptance matrices.

`scripts/check-zed-packaging.py` is the root-manifest CI ratchet for this
boundary. It verifies the whole-repository source package, requires the exact
repository-only target boundary, records
`opto-sync/opto-sync-interfaces@^0.1.0` only as a schema source until that
publication-disabled repository has an immutable public release, and rejects a
redundant Zed dependency on the native core. Observability interfaces remain
application-injected while their public releases are pending. This prevents a
well-intentioned manifest-only change from publishing unusable slices,
resolving two different core revisions, or treating a synthetic registry as
release provenance.

## Registry-enabled end state

After the engine dependency is available through immutable registry provenance,
the root manifest may use one release version and publish at least these
additional target packages:

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

Registry enablement must also use a resolver-generated `.zpkg.lock`, run
`zed r2g` for every target, and prove each installed target with its native
toolchain. It must not rely on the author's sibling checkout, an uncommitted
symlink, or a hand-authored lock. The present clean-room archives are evidence
for relocatability and runtime behavior, not immutable public-package
provenance.

## Compatibility constraints

Two known downstream repositories currently pin both repositories as sibling
git submodules:

- `sonus-auris/sonus-auris-sync`
- `voxletra/voxletra-sync`

A path-layout migration must include compatible downstream gitlink/build updates
and a clean-clone test in both consumers. The client and engine revisions should
be bumped together whenever their path or ABI contracts move in lockstep.
