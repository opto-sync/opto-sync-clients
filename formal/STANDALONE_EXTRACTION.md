# Standalone formal-methods extraction

`opto-sync/opto-sync-clients` remains the authoritative incubator until
`ORESoftware/formal-methods.rs` exists and passes compatibility checks against
current consumers.

The extraction boundary is machine-readable in
`formal/standalone-export.v1.json`. It is intentionally a whitelist: reusable
`fmctl`, streaming protocol, shared fixtures, and SDK assets are exported while
Opto Sync clients, product models, generated product traces, and the pinned
`syncer.c` engine are excluded.

## Validate the source tree

```bash
python3 tools/export_formal_methods_standalone.py --check
```

The command rejects missing contract entries, forbidden product paths, symlinks,
submodules, and non-regular files.

## Produce a candidate standalone tree

The destination must be outside the source repository and absent or empty.

```bash
candidate="$(mktemp -d)"
python3 tools/export_formal_methods_standalone.py --destination "$candidate"
```

The exporter copies tracked source bytes exactly and writes
`SOURCE_EXPORT.json`. That provenance records the source repository, source
commit, source tree, contract digest, and ordered SHA-256/size metadata for every
exported file.

## Reproducibility gate

`tools/test_formal_methods_standalone_export.sh` performs two independent exports
from the same source commit and requires byte-for-byte identical trees and
provenance. It verifies every exported digest, rejects product-directory leakage
and symlinks, and `cargo check --locked`s the exported `fmctl` crate without
reaching back into the source checkout.

GitHub Actions runs the same gate whenever an exported asset or the export
contract changes.

## Repository bootstrap

When repository creation is available:

1. create `ORESoftware/formal-methods.rs` with `main` as its default branch;
2. run the exporter from a reviewed, green Opto Sync source commit;
3. initialize the candidate tree as the standalone repository without rewriting
   exported files;
4. commit `SOURCE_EXPORT.json` with the imported tree;
5. add standalone repository metadata, CI, Nix/Zed packaging, and migration docs
   in subsequent reviewed commits;
6. run protocol golden fixtures and compatibility consumers before changing any
   Opto Sync import path; and
7. record the exact source commit and standalone import commit in Linear DEN-580
   and GitHub issue #77.

The extraction is not complete merely because the files have moved. Exact
protocol/result bytes, exit classifications, resource-policy semantics, and
report publication behavior must remain compatible until an explicitly versioned
contract change says otherwise.
