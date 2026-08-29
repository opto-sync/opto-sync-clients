# Zed packaging

`opto-sync-clients` is packaged as the whole-repository Zed source package
`opto-sync/opto-sync-clients@0.4.0`.

The repository contains `syncer.c` as a real mode-`160000` git submodule. Each
client resolves its native reconciliation binding through that root submodule,
so a client commit names the exact core commit it was tested with. Clone with
`--recurse-submodules` (or run `git submodule update --init --recursive`) before
building, testing, packing, or publishing.

The SDK schema contract records
`opto-sync/opto-sync-interfaces@^0.1.0`, but that repository has no immutable
tag or release and explicitly disables publication. It therefore remains a
source contract rather than a root install dependency. The SDK contract also
records `ores-otel/ores-interfaces@^0.1.0` and
`oresoftware/next-loggers@^0.1.0` as application-injected coordinates; they
stay out of the manifest until immutable public releases can be resolved by a
clean frozen install. The reconciliation engine is already pinned and bundled
by the `syncer.c` gitlink, so it must not appear as a second Zed dependency.
The committed `.zpkg.lock` is source/reproducibility metadata and is
intentionally stripped from published archives by zed-pkg; consumers create
their own resolved dependency lock.

## Why this is one repository package

The repository is polyglot, but a publish target must also be independently
buildable. TypeScript, Dart, Rust, and Gleam each need files below the root
`syncer.c/` gitlink. A target such as `dir = "clients/rust"` would therefore omit
the C core and Rust binding required by its own `Cargo.toml`.

The root manifest intentionally exposes only its whole-repository target. The
30 runtime entries in the client contract are API/conformance coverage, not
permission to publish their directories in isolation. The complete installed
source artifact contains every client plus the pinned reconciliation engine;
the package checker rejects language-target fan-out and any second native core
dependency. `zed r2g` proves the root artifact resolves within a fresh local
registry/install roundtrip.

Possible future designs include:

1. native ecosystem packages that consume a separately installed
   `opto-sync/syncer-c` artifact;
2. a generated, hash-checked copy of the minimal C core in each language target;
3. Zed adapter support that maps an installed source dependency into native
   package-manager metadata without machine-specific absolute paths.

## Package boundary

The artifact includes:

- the root package manifest, license, and README;
- the canonical envelope, telemetry, and portable SDK API JSON Schema
  contracts;
- every maintained client source tree and native manifest; and
- the initialized `syncer.c` source materialized from the pinned gitlink
  revision.

The source repository's `.gitmodules` declaration and mode-`160000` gitlink are
validated before packing. The publish policy explicitly omits `.gitmodules`
with the rest of the VCS metadata because the artifact already carries the
materialized `syncer.c` source; the packaging checker keeps direct pack and
`r2g` behavior aligned. The artifact also excludes the root Zed lockfile, CI
metadata, tests, dependency trees, compiler output, package-manager caches, and
nested submodule administration. No Zed `[build]` hook is declared, so
installing the source package does not execute publisher-controlled build
commands automatically.

## Validation

The normal `CI` workflow runs the four runtime suites against the pinned
submodule. The `Zed package contract` workflow additionally:

- verifies the mode-`160000` gitlink and every native dependency path;
- verifies the pending protocol-interface source, the still-injected
  observability coordinates, and all portable Rust/Dart/TypeScript API bindings;
- builds pinned `zed-cli` and `zed-interfaces` revisions;
- packs twice and requires byte-for-byte identical archives;
- audits required files and rejects generated/VCS state; and
- performs a non-mutating publish dry run; and
- runs a clean local registry/install roundtrip for the declared targets.

From a recursive clean checkout:

```sh
python3 scripts/check-dependency-boundary.py
zed pack
zed publish --dry-run
zed r2g --clean
```

## Registry publication

`.github/workflows/zed-publish.yml` dry-runs on relevant pull requests and
performs a real upload only from the exact version tag declared by
`.zpkg.toml`. For version `0.4.0`, the accepted tag is exactly `v0.4.0`—not an
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
4. place `v0.4.0` on the reviewed `main` commit; and
5. let the tag workflow publish `opto-sync/opto-sync-clients@0.4.0`.

A green dry run means the artifact is reproducible and uploadable. It does not
by itself mean the package is already present in the registry. This gitlink
contract replaces the earlier mutable sibling-checkout release model.
