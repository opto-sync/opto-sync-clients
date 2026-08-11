# Zed packaging

`opto-sync-clients` is packaged as the whole-repository Zed source package
`opto-sync/opto-sync-clients@0.3.0`.

The repository contains `syncer.c` as a real mode-`160000` git submodule. Each
client resolves its native reconciliation binding through that root submodule,
so a client commit names the exact core commit it was tested with. Clone with
`--recurse-submodules` (or run `git submodule update --init --recursive`) before
building, testing, packing, or publishing.

The root `.zpkg.lock` is committed even though this package currently has no
Zed-managed dependencies. It is source/reproducibility metadata and is
intentionally stripped from published archives by zed-pkg; consumers create
their own dependency lock.

## Why this is one repository package

The repository is polyglot, but a publish target must also be independently
buildable. TypeScript, Dart, Rust, and Gleam each need files below the root
`syncer.c/` gitlink. A target such as `dir = "clients/rust"` would therefore omit
the C core and Rust binding required by its own `Cargo.toml`.

The root manifest intentionally has no `[targets]` block. The complete source
artifact contains all four clients plus the pinned reconciliation engine.
Language-specific Zed packages should be added only after each clean-room
artifact can resolve the native core without a sibling checkout or a path that
escapes its target root.

Possible future designs include:

1. native ecosystem packages that consume a separately installed
   `opto-sync/syncer-c` artifact;
2. a generated, hash-checked copy of the minimal C core in each language target;
3. Zed adapter support that maps an installed source dependency into native
   package-manager metadata without machine-specific absolute paths.

## Package boundary

The artifact includes:

- the root package manifest, license, README, and `.gitmodules` declaration;
- every maintained client source tree and native manifest; and
- the initialized `syncer.c` submodule at the pinned gitlink revision.

It excludes the root Zed lockfile, VCS/CI metadata, tests, dependency trees,
compiler output, package-manager caches, and nested submodule administration.
No Zed `[build]` hook is declared, so installing the source package does not
execute publisher-controlled build commands automatically.

## Validation

The normal `CI` workflow runs the four runtime suites against the pinned
submodule. The `Zed package contract` workflow additionally:

- verifies the mode-`160000` gitlink and every native dependency path;
- builds pinned `zed-cli` and `zed-interfaces` revisions;
- packs twice and requires byte-for-byte identical archives;
- audits required files and rejects generated/VCS state; and
- performs a non-mutating publish dry run.

From a recursive clean checkout:

```sh
python3 scripts/check-dependency-boundary.py
zed pack
zed publish --dry-run
```

## Registry publication

`.github/workflows/zed-publish.yml` dry-runs on relevant pull requests and
performs a real upload only from the exact version tag declared by
`.zpkg.toml`. For version `0.3.0`, the accepted tag is exactly `v0.3.0`—not an
arbitrary `v*` tag. The workflow fetches full tag history, initializes the
pinned native submodule, disables persisted checkout credentials, builds pinned
Zed tooling, reruns the dependency-boundary check, verifies the tag points at
the checked-out commit, and reads registry authority only from the repository
secret `ZED_PKG_TOKEN`.

Release order matters:

1. merge and publish `opto-sync/syncer-c@0.2.1`;
2. merge this client package with its gitlink pinned to that reviewed core
   commit;
3. provision the `opto-sync` registry namespace and this repository's
   `ZED_PKG_TOKEN`;
4. place `v0.3.0` on the reviewed `main` commit; and
5. let the tag workflow publish `opto-sync/opto-sync-clients@0.3.0`.

A green dry run means the artifact is reproducible and uploadable. It does not
by itself mean the package is already present in the registry. This gitlink
contract replaces the earlier mutable sibling-checkout release model.
