# TypeScript Zed target prototype

The whole-repository `opto-sync/opto-sync-clients` package remains the authoritative published artifact. This prototype proves the first language-only boundary required by DEN-311 and DEN-527 without enabling publication early.

## Target contents

`scripts/stage-typescript-target.py` creates a clean source tree outside the Git checkout containing only:

- `clients/ts` (`@opto-sync/client` 0.4.0);
- `syncer.c/core` source and headers;
- `syncer.c/bindings/typescript` (`@opto-sync/syncer` 0.2.1);
- `syncer.c/bindings/wasm` (`@opto-sync/syncer-wasm` 0.2.1);
- MIT license and target README;
- an isolated `.zpkg.toml`; and
- `release-set.json` with the exact client and core commit identities.

The stage preserves the source layout expected by the existing package manifests and native `binding.gyp`, so no dependency path escapes the target root. Other client languages, Git metadata, CI configuration, caches, `node_modules`, native build output, and client `dist/` output are excluded. The checked WASM `dist/` artifact is retained because it is a required browser runtime input.

## Release identity and coexistence

The staged `release-set.json` records:

- the exact `opto-sync-clients` source commit;
- the mode-160000 `syncer.c` gitlink and initialized submodule commit;
- client and core versions;
- bundled-source core resolution; and
- the rule that this target and the whole-repository package may coexist only when they resolve the same core SHA.

`scripts/check-typescript-one-core.py` compares the staged target identity with both the repository gitlink and the initialized nested core. CI also mutates a copy of the release-set manifest and requires a deliberate second-core revision to fail before package installation or runtime state changes. This is the source/package preflight; the final publication gate still requires the real Zed consumer graph to enforce the same invariant.

`publicationEnabled` is deliberately `false`. The prototype package has no real tag workflow and is not part of the coordinated production release set.

## Linux clean-room proof

`.github/workflows/typescript-target-prototype.yml`:

1. checks out the immutable PR head with recursive submodules and no persisted credentials;
2. validates the merged target-layout contract;
3. stages and validates the isolated source tree;
4. builds pinned Zed CLI/interfaces revisions;
5. packs the target twice and requires byte-identical archives;
6. audits the tar boundary and excludes `.zpkg.lock`, other languages, VCS data, and generated state;
7. extracts into a blank non-Git directory;
8. runs `npm ci`, native build/version proof, and Node tests from the extracted artifact; and
9. installs Chromium and runs the real browser/WASM/IndexedDB test from that same extracted artifact.

The uploaded artifact is the original deterministic package, not the post-test directory containing downloaded dependencies or native build output.

## Cross-platform exact-artifact matrix

`.github/workflows/typescript-target-platform-matrix.yml` packs one target on Linux with the same pinned Zed tooling, uploads that exact archive once, and downloads it into blank consumers on:

- Ubuntu Linux;
- macOS 14; and
- Windows Server 2022.

Every operating system extracts without Git metadata, validates the artifact, runs `npm ci`, proves native core version `0.2.1`, compiles CommonJS and ESM, executes the native reconciliation and IndexedDB queue consumers, and runs real Chromium with the WASM/IndexedDB consumer. It then removes dependencies and native build output, repeats the frozen install, and requires unchanged npm lock metadata plus the same source/core identity.

`clients/ts/scripts/native-platform.mjs` is the single reviewed native support table. Supported Node/native targets are Linux, macOS, and Windows on x64 or arm64. Unsupported platform/architecture pairs return a non-zero diagnostic that names the target, explains that the Node entry point requires the native addon, and directs browser-only consumers to the browser export/WASM engine. The postinstall hook prints the same explicit diagnostic; it never silently substitutes another merge engine for the Node entry point.

## Remaining publication gates

Before this can become a published Zed target:

- the coordinated release-set manifest must approve the exact client/core pair;
- coexistence with the installed whole-repository artifact must be exercised through a real Zed install graph, not only source/package preflight checks;
- the cross-platform matrix must remain green on supported modes;
- package naming and release ownership must be approved; and
- tag-gated publication must use protected credentials and immutable provenance.

Until those gates pass, this is a reviewed, reproducible target prototype—not a released package.
