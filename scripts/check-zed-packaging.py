#!/usr/bin/env python3
"""Validate the current whole-repository Zed package and future target safety."""

from __future__ import annotations

import json
import posixpath
import re
import sys
import tomllib
from pathlib import Path, PurePosixPath

SOURCE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SOURCE_ROOT


def read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def normalize_from(package_dir: str, dependency_path: str) -> str:
    value = dependency_path.removeprefix("file:")
    return posixpath.normpath(posixpath.join(package_dir, value))


def inside_package(path: str) -> bool:
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
        "nodejs-native": ("clients/ts", node["optionalDependencies"]["@opto-sync/syncer"]),
        "nodejs-wasm": ("clients/ts", node["dependencies"]["@opto-sync/syncer-wasm"]),
        "dart": ("clients/dart", dart_syncer_path()),
        "rust": ("clients/rust", rust["dependencies"]["syncer-rs"]["path"]),
        "gleam": ("clients/gleam", gleam["dependencies"]["opto_sync"]["path"]),
    }


def main() -> int:
    manifest = read_toml(ROOT / ".zpkg.toml")
    lock_path = ROOT / ".zpkg.lock"

    package = manifest["package"]
    assert package["org"] == "opto-sync"
    assert package["name"] == "opto-sync-clients"
    assert package["version"] == "0.2.0"
    assert package["repository"]["url"] == "https://github.com/opto-sync/opto-sync-clients"
    assert manifest["dependencies"]["opto-sync/syncer"] == "^0.2.1"
    assert (ROOT / "LICENSE").is_file()

    # The lockfile is mandatory in the source repository, but zed-pkg strips it
    # from published artifacts by design. Consumers get the artifact's derived
    # manifest and their own lock; they must not inherit the publisher's lock.
    if lock_path.exists():
        lockfile = read_toml(lock_path)
        assert lockfile.get("version") == 1
    elif ROOT == SOURCE_ROOT:
        raise AssertionError("source repository must commit .zpkg.lock")

    paths = dependency_paths()
    escaped: dict[str, str] = {}
    for client, (package_dir, dependency_path) in paths.items():
        resolved = normalize_from(package_dir, dependency_path)
        if not inside_package(resolved):
            escaped[client] = resolved

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

    targets = manifest.get("targets", {})
    if targets and escaped:
        details = "\n".join(f"  - {client}: {path}" for client, path in escaped.items())
        print(
            "refusing language targets while native manifests still resolve "
            "syncer.c outside each target artifact:\n"
            f"{details}\n"
            "Make the engine binding relocatable or self-contained before "
            "publishing target slices.",
            file=sys.stderr,
        )
        return 1

    artifact_kind = "source repository" if lock_path.exists() else "installed artifact"
    if escaped:
        print(
            f"Zed package contract passed for {artifact_kind}: this remains one "
            "whole-repository source package, and isolated language targets are "
            "correctly absent."
        )
    else:
        print(f"Zed package contract passed for {artifact_kind}: native dependencies are package-contained.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
