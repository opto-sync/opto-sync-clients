#!/usr/bin/env python3
"""Validate a staged or extracted Dart/Flutter Zed target without Git metadata."""

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
    print(f"dart-target: {message}", file=sys.stderr)
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


def load_pubspec(path: Path) -> dict[str, str]:
    """Read the small identity/path subset needed without adding a YAML runtime."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        fail(f"cannot load {path.relative_to(ROOT)}: {exc}")
    values: dict[str, str] = {}
    in_syncer = False
    for line in lines:
        if line.startswith("name:"):
            values["name"] = line.split(":", 1)[1].strip().strip("'\"")
        elif line.startswith("version:"):
            values["version"] = line.split(":", 1)[1].strip().strip("'\"")
        elif line == "  syncer:":
            in_syncer = True
        elif in_syncer and line.startswith("    path:"):
            values["syncer.path"] = line.split(":", 1)[1].strip().strip("'\"")
            in_syncer = False
        elif in_syncer and line and not line.startswith("    "):
            in_syncer = False
    return values


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
        "scripts/check-dart-target.py",
        "clients/dart/pubspec.yaml",
        "clients/dart/lib/opto_sync_client.dart",
        "clients/dart/lib/src/syncer_backend_native.dart",
        "clients/dart/lib/src/syncer_backend_stub.dart",
        "clients/dart/lib/web.dart",
        "clients/dart/test/web/browser_e2e.dart",
        "clients/dart/tool/web_e2e.mjs",
        "schema/fixtures/valid/basic-upsert.json",
        "schema/fixtures/invalid/bad-table-identifier.json",
        "schema/opto-sync-telemetry.schema.json",
        "schema/telemetry-fixtures/valid/cycle-completed.json",
        "syncer.c/SOURCE_SHA",
        "syncer.c/core/CMakeLists.txt",
        "syncer.c/core/include/syncer.h",
        "syncer.c/core/src/syncer.c",
        "syncer.c/core/src/yyjson.c",
        "syncer.c/core/test/test_syncer.c",
        "syncer.c/bindings/dart/pubspec.yaml",
        "syncer.c/bindings/dart/pubspec.lock",
        "syncer.c/bindings/dart/lib/syncer.dart",
        "syncer.c/bindings/wasm/package.json",
        "syncer.c/bindings/wasm/index.mjs",
        "syncer.c/bindings/wasm/dist/syncer-core.single.mjs",
    )
    for relative in required:
        require_file(relative)
    if (ROOT / "clients/dart/pubspec.lock").exists():
        fail("Dart library target leaked a generated client pubspec.lock")

    manifest = load_toml(ROOT / ".zpkg.toml")
    package = manifest.get("package", {})
    expected = {
        "org": "opto-sync",
        "name": "opto-sync-client-dart",
        "version": "1.1.0",
        "license": "MIT",
    }
    for key, value in expected.items():
        if package.get(key) != value:
            fail(f"package.{key} must be {value!r}")
    if manifest.get("dependencies") or manifest.get("targets"):
        fail("the bundled Dart target may not resolve another core or nested target")
    if manifest.get("publish", {}).get("tag_format") != "dart-v{version}":
        fail("publish.tag_format must isolate Dart release tags")
    lock_path = ROOT / ".zpkg.lock"
    if lock_path.exists() and load_toml(lock_path).get("version") != 1:
        fail(".zpkg.lock must declare format version 1 when present")

    release = load_json(ROOT / "release-set.json")
    expected_release = {
        "schemaVersion": 1,
        "target": "dart",
        "package": "opto-sync/opto-sync-client-dart",
        "clientVersion": "1.1.0",
        "syncerVersion": "0.2.1",
        "coreResolution": "bundled-source",
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.4.0",
        "coexistenceRule": (
            "all installed opto-sync targets must resolve the same syncerSourceSha"
        ),
        "supportedPlatforms": [
            "linux",
            "macos",
            "windows",
            "browser",
            "flutter-mobile",
        ],
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
        "clientPubspecSha256": ROOT / "clients/dart/pubspec.yaml",
        "bindingPubspecSha256": ROOT / "syncer.c/bindings/dart/pubspec.yaml",
        "bindingPubLockSha256": ROOT / "syncer.c/bindings/dart/pubspec.lock",
    }
    for key, path in digest_inputs.items():
        if release.get(key) != sha256(path):
            fail(f"release-set {key} is stale")

    client = load_pubspec(ROOT / "clients/dart/pubspec.yaml")
    if (client.get("name"), client.get("version")) != ("opto_sync_client", "1.1.0"):
        fail("unexpected Dart client package identity")
    syncer_path = client.get("syncer.path")
    if syncer_path != "../../syncer.c/bindings/dart":
        fail("Dart client must resolve the bundled FFI binding")
    resolved = resolve_inside(ROOT / "clients/dart", syncer_path)
    if resolved != (ROOT / "syncer.c/bindings/dart").resolve():
        fail("Dart path dependency does not resolve to the bundled binding")
    binding = load_pubspec(ROOT / "syncer.c/bindings/dart/pubspec.yaml")
    if (binding.get("name"), binding.get("version")) != ("syncer", "0.2.1"):
        fail("unexpected bundled Dart binding identity")

    native_stub = (ROOT / "clients/dart/lib/src/syncer_backend_stub.dart").read_text(
        encoding="utf-8"
    )
    if "UnsupportedError" not in native_stub or "WasmSyncer" not in native_stub:
        fail("unsupported Dart runtimes must receive an actionable typed error")
    web_harness = (ROOT / "clients/dart/tool/web_e2e.mjs").read_text(encoding="utf-8")
    if "await import('playwright')" not in web_harness or "../../ts/" in web_harness:
        fail("Dart browser harness must use an explicit isolated Playwright dependency")
    if "engineVersion, '0.2.1'" not in web_harness or "storageApi, 'indexedDb'" not in web_harness:
        fail("Dart browser harness must prove the WASM core and real IndexedDB")

    other_clients = sorted(path.name for path in (ROOT / "clients").iterdir() if path.name != "dart")
    if other_clients:
        fail(f"Dart target leaked other client roots: {other_clients}")
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if path.is_symlink():
            fail(f"source artifact contains a symlink: {relative}")
        if any(part in FORBIDDEN for part in relative.parts):
            fail(f"generated/VCS state leaked into target: {relative}")

    kind = "source stage" if lock_path.exists() else "packed/extracted artifact"
    print(
        f"Dart target passed ({kind}): client={release['clientSourceSha'][:12]} "
        f"core={source_sha[:12]} binding-lock={release['bindingPubLockSha256'][:12]} "
        "publication=disabled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
