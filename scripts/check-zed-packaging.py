#!/usr/bin/env python3
"""Validate the current source package and reject incomplete language targets."""

from __future__ import annotations

import json
import posixpath
import re
import sys
import tomllib
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".zpkg.toml"
LOCKFILE = ROOT / ".zpkg.lock"


def read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def normalize_from(package_dir: str, dependency_path: str) -> str:
    value = dependency_path.removeprefix("file:")
    return posixpath.normpath(posixpath.join(package_dir, value))


def inside(path: str, root: str) -> bool:
    path_parts = PurePosixPath(path).parts
    root_parts = PurePosixPath(root).parts
    if PurePosixPath(path).is_absolute() or ".." in path_parts:
        return False
    if root in ("", "."):
        return True
    return path_parts[: len(root_parts)] == root_parts


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


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def main() -> int:
    manifest = read_toml(MANIFEST)
    package = manifest.get("package", {})
    expected_package = {
        "org": "opto-sync",
        "name": "opto-sync-clients",
        "version": "0.2.0",
    }
    actual_package = {key: str(package.get(key)) for key in expected_package}
    if actual_package != expected_package:
        return fail(
            f"unexpected root Zed package identity: {actual_package!r}; "
            f"expected {expected_package!r}"
        )

    dependencies = manifest.get("dependencies", {})
    if dependencies.get("opto-sync/syncer") != "^0.2.1":
        return fail(
            "the root source package must declare opto-sync/syncer = ^0.2.1"
        )

    lock = read_toml(LOCKFILE)
    if lock.get("version") != 1:
        return fail(".zpkg.lock must declare format version 1")

    paths = dependency_paths()
    expected_suffixes = {
        "nodejs-native": "syncer.c/bindings/typescript",
        "nodejs-wasm": "syncer.c/bindings/wasm",
        "dart": "syncer.c/bindings/dart",
        "rust": "syncer.c/bindings/rust",
        "gleam": "syncer.c/bindings/gleam",
    }

    escaped_from_repo: dict[str, str] = {}
    for client, (package_dir, dependency_path) in paths.items():
        normalized_dependency = dependency_path.removeprefix("file:").replace("\\", "/")
        if not normalized_dependency.endswith(expected_suffixes[client]):
            return fail(
                f"{client} drifted from the expected shared-engine binding: "
                f"{dependency_path}"
            )

        resolved = normalize_from(package_dir, dependency_path)
        if not inside(resolved, "."):
            escaped_from_repo[client] = resolved

    # A whole-repository source package is the current honest boundary. Its Zed
    # dependency records the engine relationship, while the native manifests
    # retain the established sibling-checkout layout. An isolated target is only
    # valid when every dependency used by files under that target also lives
    # inside the target artifact (or has been rewritten to an ecosystem package).
    targets = manifest.get("targets", {})
    invalid_targets: list[str] = []
    for target_name, target in targets.items():
        target_dir = posixpath.normpath(str(target.get("dir", ".")))
        if target_dir in ("", "."):
            continue

        affected = []
        for client, (package_dir, dependency_path) in paths.items():
            if inside(package_dir, target_dir):
                resolved = normalize_from(package_dir, dependency_path)
                if not inside(resolved, target_dir):
                    affected.append(f"{client} -> {resolved}")
        if affected:
            invalid_targets.append(
                f"  - {target_name} (dir={target_dir}): " + ", ".join(affected)
            )

    if invalid_targets:
        return fail(
            "refusing incomplete Zed language targets; their native manifests "
            "reach outside the target artifact:\n"
            + "\n".join(invalid_targets)
            + "\nMake the engine dependency relocatable, vendor verified source, "
            "or materialize the Zed dependency inside each clean-room target."
        )

    if not escaped_from_repo:
        print("All client engine paths are now repository-contained; language target fan-out can be evaluated.")
    else:
        details = ", ".join(
            f"{client}={path}" for client, path in sorted(escaped_from_repo.items())
        )
        print(
            "Zed packaging contract passed: the whole-repository source package "
            "is declared, no incomplete language target is advertised, and the "
            f"known sibling engine paths remain explicit ({details})."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
