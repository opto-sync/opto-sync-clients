# Native-core dependency provenance

`opto-sync-clients` contains the reconciliation engine as the root `syncer.c`
git submodule. The gitlink is the source of truth for every native path
dependency in this repository.

Current reviewed pin:

```text
opto-sync/syncer.c
7795ce2d1342e17d934d2faafff5c8ed4322609e
```

That core revision includes the `opto-sync/syncer`, `opto-sync/syncer-c`, and
`opto-sync/syncer-wasm` Zed package fan-out, cross-binding version checks,
deterministic double-pack validation, clean consumer tests, registry/install
roundtrips, fail-closed tag publication, MIT license completeness, and private
vulnerability reporting.

## Verify a checkout

```sh
git submodule update --init --recursive
git submodule status --cached syncer.c
python3 scripts/check-dependency-boundary.py
```

The boundary check requires:

- `.gitmodules` to use the canonical public HTTPS URL;
- `syncer.c` to be a real mode-`160000` gitlink;
- the initialized submodule HEAD to equal the superproject pin;
- every TypeScript, Dart, Rust, and Gleam native path to stay inside this
  repository; and
- the npm lockfile root and local-link graph to match `package.json`.

## Update procedure

1. Review and merge the core change in `opto-sync/syncer.c` first.
2. Update only the `syncer.c` gitlink to the reviewed core commit.
3. Run the four client suites and both Zed package workflows.
4. Inspect the client package artifact to confirm it contains the new core and
   no nested `.git`, cache, dependency, or compiler-output state.
5. Merge the client PR only after those checks pass.

Never replace the gitlink with a copied directory, a branch name, or a mutable
CI checkout of `syncer.c@main`; each of those breaks commit-level reproducibility.
