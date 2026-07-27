#!/usr/bin/env python3
"""Reject Zed manifests that would publish clients with missing path dependencies."""

from __future__ import annotations

import json
import posixpath
import re
import sys
import tomllib
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ZPKG = ROOT / ".zpkg.toml"


def read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def normalize_from(package_dir: str, dependency_path: str) -> str:
    value = dependency_path.removeprefix("file:")
    return posixpath.normpath(posixpath.join(package_dir, value))


def inside_repo(path: str) -> bool:
    pure = PurePosixPath(path)
    return not pure.is_absolute() and ".." not in pure.parts


def dart_syncer_path() -> str:
    text = (ROOT / "clients/dart/pubspec.yaml").read_text(encoding="utf-8")
    match = re.search(r"(?m)^\s*syncer:\s*\n\s*path:\s*([^\s#]+)", text)
    if not match:
        raise AssertionError("clients/dart/pubspec.yaml must declare the syncer path dependency")
    return match.group(1)


def dependency_paths() -> dict[str, tuple[str, str]]:
    node = json.loads((ROOT / "clients/ts/package.json").read_text(encoding="utf-8"))
    rust = read_toml(ROOT / "clients/rust/Cargo.toml")
    gleam = read_toml(ROOT / "clients/gleam/gleam.toml")

    return {
        "nodejs-native": (
            "clients/ts",
            node["optionalDependencies"]["@opto-sync/syncer"],
        ),
        "nodejs-wasm": (
            "clients/ts",
            node["dependencies"]["@opto-sync/syncer-wasm"],
        ),
        "dart": ("clients/dart", dart_syncer_path()),
        "rust": (
            "clients/rust",
            rust["dependencies"]["syncer-rs"]["path"],
        ),
        "gleam": (
            "clients/gleam",
            gleam["dependencies"]["opto_sync"]["path"],
        ),
    }


def main() -> int:
    paths = dependency_paths()
    escaped: dict[str, str] = {}

    for client, (package_dir, dependency_path) in paths.items():
        resolved = normalize_from(package_dir, dependency_path)
        if not inside_repo(resolved):
            escaped[client] = resolved

    # Escaping the repository is the current, documented source-checkout
    # contract. It becomes a packaging bug only when a root Zed manifest claims
    # this repository can be packed as a self-contained artifact.
    if ZPKG.exists() and escaped:
        details = "\n".join(f"  - {client}: {path}" for client, path in escaped.items())
        print(
            "refusing an incomplete .zpkg.toml: native client manifests still "
            "resolve syncer.c outside the package root:\n"
            f"{details}\n"
            "Make the engine a declared/materialized package dependency, vendor "
            "the required binding bytes, or rewrite the release layout before "
            "adding Zed targets.",
            file=sys.stderr,
        )
        return 1

    expected = {
        "nodejs-native": "syncer.c/bindings/typescript",
        "nodejs-wasm": "syncer.c/bindings/wasm",
        "dart": "syncer.c/bindings/dart",
        "rust": "syncer.c/bindings/rust",
        "gleam": "syncer.c/bindings/gleam",
    }
    for client, suffix in expected.items():
        actual = paths[client][1].removeprefix("file:").replace("\\", "/")
        if not actual.endswith(suffix):
            print(f"{client} drifted from the shared engine binding: {actual}", file=sys.stderr)
            return 1

    print(
        "Zed packaging readiness guard passed: all clients use the expected "
        "shared engine paths, and no self-contained package is claimed yet."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
