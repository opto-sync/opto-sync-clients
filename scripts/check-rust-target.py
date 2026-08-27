#!/usr/bin/env python3
"""Validate a staged or extracted Rust Zed target without Git metadata."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tomllib
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SOURCE_ROOT
SHA = re.compile(r"^[0-9a-f]{40}$")
FORBIDDEN = {
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
    print(f"rust-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_file(relative: str) -> Path:
    path = ROOT / relative
    if not path.is_file():
        fail(f"required target file is missing: {relative}")
    return path


def require_fixture_directory(relative: str) -> tuple[Path, list[Path]]:
    path = ROOT / relative
    if not path.is_dir() or path.is_symlink():
        fail(f"required fixture directory is missing or unsafe: {relative}")
    fixtures = sorted(candidate for candidate in path.iterdir() if candidate.suffix == ".json")
    if not fixtures:
        fail(f"fixture directory contains no JSON files: {relative}")
    for fixture in fixtures:
        if not fixture.is_file() or fixture.is_symlink():
            fail(f"fixture must be a normal JSON file: {fixture.relative_to(ROOT)}")
    return path, fixtures


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot load {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain an object")
    return value


def load_toml(path: Path) -> dict:
    try:
        with path.open("rb") as handle:
            value = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"cannot load {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain a TOML table")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside(path: Path) -> None:
    try:
        path.resolve().relative_to(ROOT)
    except ValueError:
        fail(f"path escapes target root: {path}")


def main() -> int:
    required = (
        ".zpkg.toml",
        "LICENSE",
        "README.md",
        "release-set.json",
        "scripts/check-rust-target.py",
        "clients/api-surface.json",
        "clients/rust/Cargo.toml",
        "clients/rust/Cargo.lock",
        "clients/rust/src/lib.rs",
        "clients/rust/src/bin/core_identity.rs",
        "contract/bin/check_surface.py",
        "contract/bin/extract.py",
        "contract/bin/jsonschema_mini.py",
        "contract/surface.contract.json",
        "contract/surface.schema.json",
        "schema/fixtures/valid/basic-upsert.json",
        "schema/fixtures/valid/nested-keyed-arrays.json",
        "schema/fixtures/invalid/bad-table-identifier.json",
        "schema/opto-sync-telemetry.schema.json",
        "schema/opto-sync-consistency.v1.schema.json",
        "schema/telemetry-fixtures/valid/cycle-completed.json",
        "formal/consistency_vectors.v1.json",
        "syncer.c/SOURCE_SHA",
        "syncer.c/core/include/syncer.h",
        "syncer.c/core/src/syncer.c",
        "syncer.c/core/src/yyjson.c",
        "syncer.c/bindings/rust/Cargo.toml",
        "syncer.c/bindings/rust/build.rs",
        "syncer.c/bindings/rust/src/lib.rs",
    )
    for relative in required:
        require_file(relative)
    _, valid_fixtures = require_fixture_directory("schema/fixtures/valid")
    _, invalid_fixtures = require_fixture_directory("schema/fixtures/invalid")
    if len(valid_fixtures) + len(invalid_fixtures) < 2:
        fail("shared schema fixture corpus is unexpectedly small")
    if (ROOT / "clients/rust/examples").exists():
        fail("conventional examples/ must not carry the packed identity probe")

    manifest = load_toml(ROOT / ".zpkg.toml")
    package = manifest.get("package", {})
    expected = {
        "org": "opto-sync",
        "name": "opto-sync-client-rust",
        "version": "0.2.0",
        "license": "MIT",
    }
    for key, value in expected.items():
        if package.get(key) != value:
            fail(f"package.{key} must be {value!r}")
    if manifest.get("dependencies"):
        fail("the bundled target must not resolve a second Zed core dependency")
    if manifest.get("targets"):
        fail("the isolated Rust package may not contain nested Zed targets")
    if manifest.get("publish", {}).get("tag_format") != "rust-v{version}":
        fail("publish.tag_format must isolate Rust release tags")

    lock_path = ROOT / ".zpkg.lock"
    if lock_path.exists() and load_toml(lock_path).get("version") != 1:
        fail(".zpkg.lock must declare format version 1 when present")

    release = load_json(ROOT / "release-set.json")
    expected_release = {
        "schemaVersion": 1,
        "target": "rust",
        "clientPackage": "opto-sync-client",
        "clientVersion": "0.2.0",
        "syncerPackage": "syncer-rs",
        "syncerVersion": "0.2.1",
        "coreResolution": "bundled-source",
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.4.0",
        "coexistenceRule": (
            "all installed opto-sync targets must resolve the same syncerSourceSha"
        ),
        "publicationEnabled": False,
    }
    for key, value in expected_release.items():
        if release.get(key) != value:
            fail(f"release-set {key} must be {value!r}")
    for key in ("clientSourceSha", "syncerSourceSha"):
        value = release.get(key)
        if not isinstance(value, str) or not SHA.fullmatch(value):
            fail(f"release-set {key} must be a 40-hex commit")
    if release.get("supportedPlatforms") != ["linux", "macos", "windows"]:
        fail("Rust supportedPlatforms must be linux, macos, and windows")

    source_sha = (ROOT / "syncer.c/SOURCE_SHA").read_text(encoding="utf-8").strip()
    if source_sha != release["syncerSourceSha"]:
        fail("bundled SOURCE_SHA differs from release-set syncerSourceSha")
    cargo_lock = ROOT / "clients/rust/Cargo.lock"
    if sha256(cargo_lock) != release.get("cargoLockSha256"):
        fail("Cargo.lock hash differs from release-set cargoLockSha256")

    client_manifest = load_toml(ROOT / "clients/rust/Cargo.toml")
    client_package = client_manifest.get("package", {})
    if (client_package.get("name"), client_package.get("version")) != (
        "opto-sync-client",
        "0.2.0",
    ):
        fail("unexpected Rust client package identity")
    dependency = client_manifest.get("dependencies", {}).get("syncer-rs")
    if not isinstance(dependency, dict) or dependency.get("path") != "../../syncer.c/bindings/rust":
        fail("syncer-rs must resolve from ../../syncer.c/bindings/rust")
    dependency_root = (ROOT / "clients/rust" / dependency["path"]).resolve()
    inside(dependency_root)
    if dependency_root != (ROOT / "syncer.c/bindings/rust").resolve():
        fail("syncer-rs path does not resolve to the bundled binding")

    binding_manifest = load_toml(ROOT / "syncer.c/bindings/rust/Cargo.toml")
    binding_package = binding_manifest.get("package", {})
    if (binding_package.get("name"), binding_package.get("version")) != (
        "syncer-rs",
        "0.2.1",
    ):
        fail("unexpected bundled syncer-rs identity")
    build_rs = (ROOT / "syncer.c/bindings/rust/build.rs").read_text(encoding="utf-8")
    for relative in (
        "../../core/src/syncer.c",
        "../../core/src/yyjson.c",
        "../../core/include",
    ):
        if relative not in build_rs:
            fail(f"syncer-rs build no longer compiles bundled path {relative}")

    cargo_lock_value = load_toml(cargo_lock)
    packages = cargo_lock_value.get("package", [])
    identities = {
        (item.get("name"), item.get("version"))
        for item in packages
        if isinstance(item, dict)
    }
    for identity in (("opto-sync-client", "0.2.0"), ("syncer-rs", "0.2.1")):
        if identity not in identities:
            fail(f"Cargo.lock is missing package identity {identity}")
    lock_text = cargo_lock.read_text(encoding="utf-8")
    if "../../../syncer.c" in lock_text or "path+file://" in lock_text:
        fail("Cargo.lock contains a mutable or machine-local path")

    clients = ROOT / "clients"
    allowed_client_entries = {"rust", "api-surface.json"}
    leaked = sorted(path.name for path in clients.iterdir() if path.name not in allowed_client_entries)
    if leaked:
        fail(f"Rust target leaked other client roots: {leaked}")

    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if path.is_symlink():
            fail(f"source artifact contains a symlink: {relative}")
        if any(part in FORBIDDEN for part in relative.parts):
            fail(f"generated/VCS state leaked into target: {relative}")

    kind = "source stage" if lock_path.exists() else "packed/extracted artifact"
    print(
        f"Rust target passed ({kind}): client={release['clientSourceSha'][:12]} "
        f"core={source_sha[:12]} lock={release['cargoLockSha256'][:12]} "
        f"fixtures={len(valid_fixtures) + len(invalid_fixtures)} publication=disabled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
