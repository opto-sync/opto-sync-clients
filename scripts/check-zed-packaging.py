#!/usr/bin/env python3
"""Validate the whole-repository Zed package and reject unsafe target fan-out."""

from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
VALIDATING_SOURCE = len(sys.argv) == 1
ROOT = SOURCE_ROOT if VALIDATING_SOURCE else Path(sys.argv[1]).resolve()


def read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def fail(message: str) -> None:
    print(f"zed-package: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    manifest_path = ROOT / ".zpkg.toml"
    if not manifest_path.is_file():
        fail(".zpkg.toml is missing")
    manifest = read_toml(manifest_path)
    package = manifest.get("package", {})

    expected = {
        "org": "opto-sync",
        "name": "opto-sync-clients",
        "version": "0.3.0",
        "license": "MIT",
    }
    for key, value in expected.items():
        if package.get(key) != value:
            fail(f"package.{key} must be {value!r}, got {package.get(key)!r}")
    repository = package.get("repository", {})
    if repository.get("url") != "https://github.com/opto-sync/opto-sync-clients":
        fail("package.repository.url must be the canonical GitHub repository")

    # The intended Ores coordinates are recorded by the SDK API contract, but
    # neither 0.1.0 package is currently an immutable public Zed release. A
    # synthetic file registry is not reproducible release provenance, so the
    # source package must stay dependency-free until a real frozen install can
    # populate and verify the lock.
    dependencies = manifest.get("dependencies", {})
    if dependencies:
        fail("unreleased Zed dependencies must not be declared")
    # The artifact already contains the exact syncer.c gitlink contents used by
    # every native manifest. Declaring the same source again as a Zed dependency
    # would produce two potentially different core revisions in one install.
    if any(name.startswith("opto-sync/syncer") for name in dependencies):
        fail("the bundled pinned core must not be duplicated as a Zed dependency")

    # Language slices remain unsafe: each client reaches the shared root core.
    # Only the complete repository is independently buildable today.
    if manifest.get("targets"):
        fail("language targets are forbidden until each target is clean-room self-contained")

    publish = manifest.get("publish", {})
    if publish.get("tag_format") != "v{version}":
        fail("publish.tag_format must be v{version}")
    if not publish.get("smoke_test"):
        fail("publish.smoke_test must validate the extracted artifact")
    if publish.get("exclude", []).count(".gitmodules") != 1:
        fail(
            "publish.exclude must contain exactly one explicit .gitmodules rule "
            "so pack, publish, and r2g emit the same VCS-free artifact"
        )

    lock = ROOT / ".zpkg.lock"
    if lock.exists():
        if read_toml(lock).get("version") != 1:
            fail(".zpkg.lock must declare format version 1")
    elif VALIDATING_SOURCE:
        fail("source repository must commit .zpkg.lock")

    if not (ROOT / "LICENSE").is_file():
        fail("MIT package requires a root LICENSE")

    layout_check = ROOT / "scripts/check-package-layout.py"
    if not layout_check.is_file():
        fail("scripts/check-package-layout.py is missing from the package")
    subprocess.run([sys.executable, str(layout_check)], cwd=ROOT, check=True)

    kind = "source repository" if VALIDATING_SOURCE else "installed artifact"
    print(f"Zed package contract passed for {kind}: one package, one pinned native core")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
