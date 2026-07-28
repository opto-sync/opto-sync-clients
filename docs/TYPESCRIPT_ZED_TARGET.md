# TypeScript Zed target prototype

The whole-repository `opto-sync/opto-sync-clients` package remains the authoritative published artifact. This prototype proves the first language-only boundary required by DEN-311 and DEN-527 without enabling publication early.

## Target contents

`scripts/stage-typescript-target.py` creates a clean source tree outside the Git checkout containing only:

- `clients/ts` (`@opto-sync/client` 0.2.0);
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

`publicationEnabled` is deliberately `false`. The prototype package has no real tag workflow and is not part of the coordinated production release set.

## CI proof

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

## Remaining publication gates

Before this can become a published Zed target:

- the coordinated release-set manifest must approve the exact client/core pair;
- coexistence with the installed whole-repository artifact must be exercised through a Zed install graph, not only metadata checks;
- macOS and Windows native clean-room consumers must pass;
- unsupported-platform diagnostics must be tested explicitly;
- package naming and release ownership must be approved; and
- tag-gated publication must use protected credentials and immutable provenance.

Until those gates pass, this is a reviewed, reproducible target prototype—not a released package.
