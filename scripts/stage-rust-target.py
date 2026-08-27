#!/usr/bin/env python3
"""Stage the self-contained Rust Zed source target from a recursive checkout."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {
    ".git",
    ".github",
    ".zed",
    "target",
    "build",
    "_build",
    "node_modules",
    ".dart_tool",
    ".tmp",
}


def fail(message: str) -> None:
    print(f"stage-rust-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(cwd), *args], text=True, stderr=subprocess.STDOUT
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"git {' '.join(args)} failed: {exc.output.strip()}")


def copy_tree(
    source: Path,
    destination: Path,
    additional_ignored: frozenset[str] = frozenset(),
) -> None:
    if not source.is_dir():
        fail(f"required source directory is missing: {source.relative_to(ROOT)}")
    ignored = IGNORED | additional_ignored
    shutil.copytree(
        source,
        destination,
        ignore=lambda _directory, names: {name for name in names if name in ignored},
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: stage-rust-target.py OUTPUT_DIRECTORY")
    output = Path(sys.argv[1]).resolve()
    if output == ROOT or ROOT in output.parents:
        fail("output must be outside the source repository")
    if output.exists():
        fail("output directory already exists; choose a new staging path")
    output.mkdir(parents=True)

    client_sha = git("rev-parse", "HEAD")
    gitlink_sha = git("rev-parse", "HEAD:syncer.c")
    nested_sha = git("rev-parse", "HEAD", cwd=ROOT / "syncer.c")
    if gitlink_sha != nested_sha:
        fail(
            "pinned core gitlink and initialized submodule differ: "
            f"gitlink={gitlink_sha} nested={nested_sha}"
        )

    copy_tree(
        ROOT / "clients/rust",
        output / "clients/rust",
        frozenset({"examples"}),
    )
    # Formal/model replay adapters remain repository-source verification assets.
    # Zed source packing intentionally omits conventional examples/ trees, so
    # remove that source-only tree explicitly after copying rather than relying
    # on callback path identity inside shutil.copytree.
    # The Rust surface-contract integration test must remain meaningful in the
    # extracted clean-room target. Carry only its declared API source, schema,
    # and dependency-free checker—not the other client implementations.
    shutil.copy2(
        ROOT / "clients/api-surface.json",
        output / "clients/api-surface.json",
    )
    (output / "contract/bin").mkdir(parents=True)
    for relative in (
        "bin/check_surface.py",
        "bin/extract.py",
        "bin/jsonschema_mini.py",
        "surface.contract.json",
        "surface.schema.json",
    ):
        destination = output / "contract" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "contract" / relative, destination)

    # The Rust schema-ingest and consistency integration tests deliberately
    # consume the shared cross-language corpora. Package those files beside
    # the client so an extracted target remains testable without a Git
    # checkout or sibling repo.
    copy_tree(ROOT / "schema/fixtures", output / "schema/fixtures")
    copy_tree(
        ROOT / "schema/telemetry-fixtures",
        output / "schema/telemetry-fixtures",
    )
    shutil.copy2(
        ROOT / "schema/opto-sync-telemetry.schema.json",
        output / "schema/opto-sync-telemetry.schema.json",
    )
    shutil.copy2(
        ROOT / "schema/opto-sync-consistency.v1.schema.json",
        output / "schema/opto-sync-consistency.v1.schema.json",
    )
    (output / "formal").mkdir()
    shutil.copy2(
        ROOT / "formal/consistency_vectors.v1.json",
        output / "formal/consistency_vectors.v1.json",
    )

    copy_tree(ROOT / "syncer.c/core/include", output / "syncer.c/core/include")
    copy_tree(ROOT / "syncer.c/core/src", output / "syncer.c/core/src")
    copy_tree(ROOT / "syncer.c/bindings/rust", output / "syncer.c/bindings/rust")

    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    (output / "scripts").mkdir()
    shutil.copy2(
        ROOT / "scripts/check-rust-target.py",
        output / "scripts/check-rust-target.py",
    )
    (output / "syncer.c/SOURCE_SHA").write_text(gitlink_sha + "\n", encoding="utf-8")

    # Put the identity probe under src/bin so the exact packed artifact retains
    # a normal executable target that Cargo can compile on every supported OS.
    identity_bin = output / "clients/rust/src/bin"
    identity_bin.mkdir(parents=True, exist_ok=True)
    (identity_bin / "core_identity.rs").write_text(
        "fn main() {\n"
        "    let version = opto_sync_client::core_version();\n"
        "    println!(\"syncer.c {version}\");\n"
        "    assert_eq!(version, \"0.2.1\");\n"
        "}\n",
        encoding="utf-8",
    )

    lock_hash = sha256(output / "clients/rust/Cargo.lock")
    release = {
        "schemaVersion": 1,
        "target": "rust",
        "clientPackage": "opto-sync-client",
        "clientVersion": "0.2.0",
        "syncerPackage": "syncer-rs",
        "syncerVersion": "0.2.1",
        "clientSourceSha": client_sha,
        "syncerSourceSha": gitlink_sha,
        "cargoLockSha256": lock_hash,
        "coreResolution": "bundled-source",
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.4.0",
        "coexistenceRule": (
            "all installed opto-sync targets must resolve the same syncerSourceSha"
        ),
        "supportedPlatforms": ["linux", "macos", "windows"],
        "publicationEnabled": False,
    }
    (output / "release-set.json").write_text(
        json.dumps(release, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    (output / ".zpkg.toml").write_text(
        """[package]
org = "opto-sync"
name = "opto-sync-client-rust"
version = "0.2.0"
description = "Clean-room Rust optimistic-sync client with the exact bundled syncer.c core"
license = "MIT"
repository = { type = "git", url = "https://github.com/opto-sync/opto-sync-clients" }

[publish]
include_readme = true
registry = "https://zed.cloud"
tag_format = "rust-v{version}"
require_tag = true
require_clean = true
smoke_test = "python3 scripts/check-rust-target.py && cargo test --locked --manifest-path clients/rust/Cargo.toml --all-targets && cargo test --locked --manifest-path clients/rust/Cargo.toml --no-default-features --all-targets"
exclude = [".zpkg.lock"]
""",
        encoding="utf-8",
    )
    (output / ".zpkg.lock").write_text(
        "version = 1\n\n[dependencies]\n", encoding="utf-8"
    )
    (output / "README.md").write_text(
        f"""# opto-sync Rust target prototype

This staged source package contains the Rust client, its portable surface
contract checker, its shared schema fixture corpus, its consistency
vectors, and the exact C core and Rust FFI binding pinned by
`opto-sync-clients`.

- Client source: `{client_sha}`
- Core source: `{gitlink_sha}`
- Cargo.lock SHA-256: `{lock_hash}`

Publication is disabled in `release-set.json`. The package exists to prove
clean-room, deterministic, cross-platform consumer behavior before coordinated
release approval.
""",
        encoding="utf-8",
    )

    subprocess.run(
        [sys.executable, str(output / "scripts/check-rust-target.py"), str(output)],
        check=True,
    )
    print(
        "staged Rust target: "
        f"client={client_sha[:12]} core={gitlink_sha[:12]} lock={lock_hash[:12]}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
