# Rust clean-room Zed target

The Rust target is a source-only package staged from a recursive
`opto-sync-clients` checkout. It contains exactly:

- `clients/rust` with its committed `Cargo.lock`;
- `schema/fixtures` for the cross-language ingest contract tests;
- `syncer.c/core/include` and `syncer.c/core/src`;
- `syncer.c/bindings/rust`;
- license, release-set metadata, and the extracted-artifact validator.

No other language client, Git metadata, cache, compiler output, sibling checkout,
or second Zed core dependency is allowed.

## Why the C core is bundled

`syncer-rs/build.rs` compiles the pinned C sources through relative paths. Keeping
the binding and core together makes the artifact independently buildable on a
blank machine and preserves one auditable core identity. Declaring a second Zed
core dependency would allow the Rust crate and another installed opto-sync target
to compile different reconciliation engines.

`release-set.json`, `syncer.c/SOURCE_SHA`, and the source repository gitlink must
therefore contain the same 40-hex core commit. `check-rust-one-core.py` fails
before compilation when any identity differs.

## Clean-room proof

`.github/workflows/rust-target-matrix.yml`:

1. stages the target outside the repository;
2. validates the approved layout and release metadata;
3. packs twice with pinned Zed CLI/interfaces commits and compares bytes;
4. audits the archive boundary;
5. uploads one exact archive;
6. extracts that archive without Git metadata on Linux, macOS, and Windows;
7. preserves the committed Cargo lock while running format, default SQLite tests,
   core-only tests, and Clippy;
8. runs the packed `src/bin/core_identity.rs` binary and requires `syncer.c 0.2.1`;
9. creates a separate blank consumer crate that imports the extracted target; and
10. removes build output and repeats the locked core-only build and identity binary.

The identity probe is deliberately under `src/bin`, not the conventional
`examples/` directory. Zed source packing omits conventional examples, so placing
the proof there would let staging pass while silently removing the executable
from the exact archive used by downstream consumers.

## Publication posture

The target uses the isolated tag format `rust-v{version}`, but
`publicationEnabled` remains `false`. A green package matrix proves technical
readiness only. Publication waits for the coordinated source release, live Zed
Cloud certification, native-registry alignment, and rollback approval tracked by
DEN-309/DEN-310.

## Supported platforms

The current source target is required to build on:

- Linux x86-64 runners;
- macOS arm64 runners;
- Windows x86-64 MSVC runners.

A future platform may be added only after the exact packed artifact passes the
same external-consumer and lock/core-identity checks there.
