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
        "version": "0.2.0",
        "license": "MIT",
    }
    for key, value in expected.items():
        if package.get(key) != value:
            fail(f"package.{key} must be {value!r}, got {package.get(key)!r}")
    repository = package.get("repository", {})
    if repository.get("url") != "https://github.com/opto-sync/opto-sync-clients":
        fail("package.repository.url must be the canonical GitHub repository")

    # These are package-level contracts, not replacement native engines. SDKs
    # consume both through injected interfaces so installing this package does
    # not configure a process-global OpenTelemetry provider. Keep the exact
    # coordinates in lockstep with schema/opto-sync-sdk-api.v1.json.
    expected_dependencies = {
        "ores-otel/ores-interfaces": "^0.1.0",
        "oresoftware/next-loggers": "^0.1.0",
    }
    dependencies = manifest.get("dependencies", {})
    if dependencies != expected_dependencies:
        fail(
            "dependencies must be the canonical interfaces/logging set; "
            f"expected {expected_dependencies!r}, got {dependencies!r}"
        )
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
