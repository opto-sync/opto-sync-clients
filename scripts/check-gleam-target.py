#!/usr/bin/env python3
"""Validate a staged or extracted Gleam/BEAM Zed target without Git metadata."""

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
    ".dart_tool",
    "node_modules",
    "deps",
    "_build",
    "build",
    "target",
    ".tmp",
}


def fail(message: str) -> None:
    print(f"gleam-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_file(relative: str) -> Path:
    path = ROOT / relative
    if not path.is_file() or path.is_symlink():
        fail(f"required target file is missing or unsafe: {relative}")
    return path


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
        fail(f"{path.relative_to(ROOT)} must contain a table")
    return value


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_inside(base: Path, raw: str) -> Path:
    resolved = (base / raw).resolve()
    try:
        resolved.relative_to(ROOT)
    except ValueError:
        fail(f"path dependency escapes target root: {raw}")
    if not resolved.is_dir():
        fail(f"path dependency is missing: {raw}")
    return resolved


def main() -> int:
    required = (
        ".zpkg.toml",
        "LICENSE",
        "README.md",
        "release-set.json",
        "scripts/check-gleam-target.py",
        "smoke/core_identity.exs",
        "clients/gleam/gleam.toml",
        "clients/gleam/manifest.toml",
        "clients/gleam/src/opto_sync_client.gleam",
        "schema/fixtures/valid/basic-upsert.json",
        "schema/fixtures/invalid/bad-table-identifier.json",
        "syncer.c/SOURCE_SHA",
        "syncer.c/core/include/syncer.h",
        "syncer.c/core/src/syncer.c",
        "syncer.c/core/src/yyjson.c",
        "syncer.c/bindings/rust/Cargo.toml",
        "syncer.c/bindings/rust/build.rs",
        "syncer.c/bindings/beam/mix.exs",
        "syncer.c/bindings/beam/mix.lock",
        "syncer.c/bindings/beam/lib/syncer.ex",
        "syncer.c/bindings/beam/lib/syncer/native.ex",
        "syncer.c/bindings/beam/native/syncer_nif/Cargo.toml",
        "syncer.c/bindings/beam/native/syncer_nif/Cargo.lock",
        "syncer.c/bindings/gleam/gleam.toml",
        "syncer.c/bindings/gleam/manifest.toml",
        "syncer.c/bindings/gleam/src/opto_sync_ffi.erl",
    )
    for relative in required:
        require_file(relative)

    manifest = load_toml(ROOT / ".zpkg.toml")
    package = manifest.get("package", {})
    expected = {
        "org": "opto-sync",
        "name": "opto-sync-client-gleam",
        "version": "0.1.0",
        "license": "MIT",
    }
    for key, value in expected.items():
        if package.get(key) != value:
            fail(f"package.{key} must be {value!r}")
    if manifest.get("dependencies") or manifest.get("targets"):
        fail("the bundled Gleam target may not resolve another core or nested target")
    if manifest.get("publish", {}).get("tag_format") != "gleam-v{version}":
        fail("publish.tag_format must isolate Gleam release tags")
    lock_path = ROOT / ".zpkg.lock"
    if lock_path.exists() and load_toml(lock_path).get("version") != 1:
        fail(".zpkg.lock must declare format version 1 when present")

    release = load_json(ROOT / "release-set.json")
    expected_release = {
        "schemaVersion": 1,
        "target": "gleam",
        "package": "opto-sync/opto-sync-client-gleam",
        "clientVersion": "0.1.0",
        "syncerVersion": "0.2.1",
        "coreResolution": "bundled-source",
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.4.0",
        "coexistenceRule": (
            "all installed opto-sync targets must resolve the same syncerSourceSha"
        ),
        "supportedPlatforms": ["linux", "macos"],
        "publicationEnabled": False,
    }
    for key, value in expected_release.items():
        if release.get(key) != value:
            fail(f"release-set {key} must be {value!r}")
    for key in ("clientSourceSha", "syncerSourceSha"):
        if not isinstance(release.get(key), str) or not SHA.fullmatch(release[key]):
            fail(f"release-set {key} must be a 40-hex commit")
    source_sha = (ROOT / "syncer.c/SOURCE_SHA").read_text(encoding="utf-8").strip()
    if source_sha != release["syncerSourceSha"]:
        fail("bundled SOURCE_SHA differs from release-set syncerSourceSha")

    digest_inputs = {
        "gleamManifestSha256": ROOT / "clients/gleam/manifest.toml",
        "bindingManifestSha256": ROOT / "syncer.c/bindings/gleam/manifest.toml",
        "mixLockSha256": ROOT / "syncer.c/bindings/beam/mix.lock",
        "nifCargoLockSha256": ROOT / "syncer.c/bindings/beam/native/syncer_nif/Cargo.lock",
    }
    for key, path in digest_inputs.items():
        if release.get(key) != sha256(path):
            fail(f"release-set {key} is stale")

    client = load_toml(ROOT / "clients/gleam/gleam.toml")
    if (client.get("name"), client.get("version")) != ("opto_sync_client", "0.1.0"):
        fail("unexpected Gleam client package identity")
    opto_sync = client.get("dependencies", {}).get("opto_sync")
    if not isinstance(opto_sync, dict) or opto_sync.get("path") != "../../syncer.c/bindings/gleam":
        fail("Gleam client must resolve the bundled Gleam binding")
    resolved = resolve_inside(ROOT / "clients/gleam", opto_sync["path"])
    if resolved != (ROOT / "syncer.c/bindings/gleam").resolve():
        fail("Gleam path dependency does not resolve to the bundled binding")

    binding = load_toml(ROOT / "syncer.c/bindings/gleam/gleam.toml")
    if (binding.get("name"), binding.get("version")) != ("opto_sync", "0.2.1"):
        fail("unexpected bundled Gleam binding identity")
    nif_manifest = load_toml(ROOT / "syncer.c/bindings/beam/native/syncer_nif/Cargo.toml")
    syncer_rs = nif_manifest.get("dependencies", {}).get("syncer-rs")
    if not isinstance(syncer_rs, dict) or syncer_rs.get("path") != "../../../rust":
        fail("BEAM NIF must resolve the bundled Rust binding")
    resolve_inside(ROOT / "syncer.c/bindings/beam/native/syncer_nif", syncer_rs["path"])

    ffi = (ROOT / "syncer.c/bindings/gleam/src/opto_sync_ffi.erl").read_text(encoding="utf-8")
    if "opto_sync_nif_not_loaded" not in ffi or "OPTO_SYNC_BEAM_EBIN" not in ffi:
        fail("unsupported BEAM/NIF loads must emit the tagged recovery diagnostic")
    identity = (ROOT / "smoke/core_identity.exs").read_text(encoding="utf-8")
    if 'version == "0.2.1"' not in identity:
        fail("blank consumer must require the exact bundled core version")

    other_clients = sorted(path.name for path in (ROOT / "clients").iterdir() if path.name != "gleam")
    if other_clients:
        fail(f"Gleam target leaked other client roots: {other_clients}")
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if path.is_symlink():
            fail(f"source artifact contains a symlink: {relative}")
        if any(part in FORBIDDEN for part in relative.parts):
            fail(f"generated/VCS state leaked into target: {relative}")

    kind = "source stage" if lock_path.exists() else "packed/extracted artifact"
    print(
        f"Gleam target passed ({kind}): client={release['clientSourceSha'][:12]} "
        f"core={source_sha[:12]} mix-lock={release['mixLockSha256'][:12]} "
        "publication=disabled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
