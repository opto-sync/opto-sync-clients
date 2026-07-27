# Upstream engine main canary

The committed root `syncer.c` gitlink remains the authoritative engine for a
client release. Reproducible CI and Zed packaging always initialize and test that
exact commit.

`.github/workflows/upstream-main-canary.yml` answers a different question:
**would the current client `main` still work if its gitlink were advanced to the
current engine `main`?**

## How the canary works

1. Check out the client repository and its committed submodule recursively.
2. Record the mode-160000 gitlink SHA.
3. Remove only the initialized working directory at `syncer.c/`.
4. Check out `opto-sync/syncer.c@main` into the same path without changing the
   parent repository or its gitlink.
5. Require the release-pinned engine to be an ancestor of the candidate engine.
6. Validate that all package-manager paths remain inside the repository.
7. Run TypeScript/Node, Dart native plus real Chromium, Rust SQLite/core-only,
   and Gleam/BEAM against the candidate engine.

This is an overlay test, not a release mutation. A green canary does not move the
gitlink. It means a small reviewed gitlink-bump pull request should be possible.

## Cadence and failures

The canary runs on relevant pull requests, on demand, and nightly. A failure
usually means one of:

- the engine changed a native ABI or source layout;
- a binding version or committed WASM artifact is stale;
- a client relies on behavior outside the documented merge contract; or
- package-manager paths/locks no longer match the overlaid engine.

Fix compatibility in an upstream feature branch, run the E2E candidate-ref
workflows, and only then update the committed client gitlink.
