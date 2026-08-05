#!/usr/bin/env python3
"""Validate the staged/extracted TypeScript Zed target without Git metadata."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SOURCE_ROOT
SHA = re.compile(r"^[0-9a-f]{40}$")


def fail(message: str) -> None:
    print(f"typescript-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot load {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain a JSON object")
    return value


def load_toml(path: Path) -> dict:
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"cannot load {path.relative_to(ROOT)}: {exc}")


def require_file(relative: str) -> Path:
    path = ROOT / relative
    if not path.is_file():
        fail(f"required target file is missing: {relative}")
    return path


def resolve_dependency(manifest: Path, raw: str) -> Path:
    value = raw.removeprefix("file:")
    resolved = (manifest.parent / value).resolve()
    try:
        resolved.relative_to(ROOT)
    except ValueError:
        fail(f"{manifest.relative_to(ROOT)} dependency escapes target root: {raw}")
    if not resolved.is_dir():
        fail(f"{manifest.relative_to(ROOT)} dependency is missing: {raw}")
    return resolved


def main() -> int:
    required = (
        ".zpkg.toml",
        "LICENSE",
        "README.md",
        "release-set.json",
        "scripts/check-typescript-target.py",
        "clients/ts/package.json",
        "clients/ts/package-lock.json",
        "clients/ts/scripts/bootstrap-native-binding.mjs",
        "clients/ts/smoke/native-reconcile.cjs",
        "clients/ts/smoke/indexeddb-queue.cjs",
        "clients/ts/smoke/browser-indexeddb.mjs",
        "clients/ts/smoke/helpers/bundle.mjs",
        "clients/ts/smoke/helpers/corpus.mjs",
        "syncer.c/SOURCE_SHA",
        "syncer.c/core/include/syncer.h",
        "syncer.c/core/src/syncer.c",
        "syncer.c/core/src/yyjson.c",
        "syncer.c/bindings/typescript/package.json",
        "syncer.c/bindings/typescript/binding.gyp",
        "syncer.c/bindings/wasm/package.json",
        "syncer.c/bindings/wasm/index.mjs",
        "syncer.c/bindings/wasm/dist/syncer-core.single.mjs",
    )
    for relative in required:
        require_file(relative)

    if (ROOT / "clients/ts/test").exists():
        fail("conventional test path must be omitted from the packed target")
    for path in (ROOT / "clients/ts/smoke").rglob("*"):
        if path.is_file() and ".test." in path.name:
            fail(f"smoke consumer retains a test-like filename: {path.relative_to(ROOT)}")

    manifest = load_toml(ROOT / ".zpkg.toml")
    package_meta = manifest.get("package", {})
    expected_meta = {
        "org": "opto-sync",
        "name": "opto-sync-client-typescript",
        "version": "0.2.1",
        "license": "MIT",
    }
    for key, expected in expected_meta.items():
        if package_meta.get(key) != expected:
            fail(f"package.{key} must be {expected!r}")
    if manifest.get("targets"):
        fail("the staged prototype is already one isolated target; nested targets are forbidden")
    if manifest.get("dependencies"):
        fail("the bundled target must not resolve a second Zed core dependency")
    lock_path = ROOT / ".zpkg.lock"
    if lock_path.exists() and load_toml(lock_path).get("version") != 1:
        fail(".zpkg.lock must declare format version 1 when present")

    release = load_json(ROOT / "release-set.json")
    if release.get("schemaVersion") != 1:
        fail("release-set schemaVersion must be 1")
    if release.get("target") != "typescript":
        fail("release set must identify the TypeScript target")
    client_sha = release.get("clientSourceSha")
    core_sha = release.get("syncerSourceSha")
    if not isinstance(client_sha, str) or not SHA.fullmatch(client_sha):
        fail("release set clientSourceSha must be a 40-hex commit")
    if not isinstance(core_sha, str) or not SHA.fullmatch(core_sha):
        fail("release set syncerSourceSha must be a 40-hex commit")
    source_sha = (ROOT / "syncer.c/SOURCE_SHA").read_text(encoding="utf-8").strip()
    if source_sha != core_sha:
        fail("bundled core SOURCE_SHA differs from release-set syncerSourceSha")
    if release.get("clientVersion") != "0.2.1" or release.get("syncerVersion") != "0.2.1":
        fail("release-set package versions are inconsistent")
    if release.get("publicationEnabled") is not False:
        fail("prototype publication must remain disabled")
    if release.get("coreResolution") != "bundled-source":
        fail("TypeScript target must use the approved bundled-source strategy")

    client_manifest_path = ROOT / "clients/ts/package.json"
    client = load_json(client_manifest_path)
    if client.get("name") != "@opto-sync/client" or client.get("version") != "0.2.1":
        fail("unexpected TypeScript client package identity")
    scripts = client.get("scripts", {})
    expected_scripts = {
        "test": "npm run build && npm run test:node && npm run test:browser",
        "test:node": "node --test smoke/indexeddb-queue.cjs smoke/native-reconcile.cjs",
        "test:browser": "node --test smoke/browser-indexeddb.mjs",
    }
    for name, expected in expected_scripts.items():
        if scripts.get(name) != expected:
            fail(f"package script {name!r} must use the extracted smoke consumers")
    serialized_scripts = json.dumps(scripts, sort_keys=True)
    if "test/" in serialized_scripts or ".test." in serialized_scripts:
        fail("staged package scripts still reference omitted test artifacts")

    dependencies = client.get("dependencies", {})
    optional = client.get("optionalDependencies", {})
    expected_paths = {
        "@opto-sync/syncer-wasm": "file:../../syncer.c/bindings/wasm",
        "@opto-sync/syncer": "file:../../syncer.c/bindings/typescript",
    }
    if dependencies.get("@opto-sync/syncer-wasm") != expected_paths["@opto-sync/syncer-wasm"]:
        fail("WASM dependency must resolve inside the target")
    if optional.get("@opto-sync/syncer") != expected_paths["@opto-sync/syncer"]:
        fail("native dependency must resolve inside the target")
    for raw in expected_paths.values():
        resolve_dependency(client_manifest_path, raw)

    lock = load_json(ROOT / "clients/ts/package-lock.json")
    locked_root = lock.get("packages", {}).get("", {})
    if locked_root.get("dependencies", {}) != dependencies:
        fail("package-lock root dependencies differ from package.json")
    if locked_root.get("optionalDependencies", {}) != optional:
        fail("package-lock root optionalDependencies differ from package.json")
    for key in ("../../syncer.c/bindings/typescript", "../../syncer.c/bindings/wasm"):
        if key not in lock.get("packages", {}):
            fail(f"package-lock is missing bundled dependency entry {key}")
        resolve_dependency(client_manifest_path, key)

    native = load_json(ROOT / "syncer.c/bindings/typescript/package.json")
    wasm = load_json(ROOT / "syncer.c/bindings/wasm/package.json")
    if (native.get("name"), native.get("version")) != ("@opto-sync/syncer", "0.2.1"):
        fail("unexpected native binding identity")
    if (wasm.get("name"), wasm.get("version")) != ("@opto-sync/syncer-wasm", "0.2.1"):
        fail("unexpected WASM binding identity")

    gyp = (ROOT / "syncer.c/bindings/typescript/binding.gyp").read_text(encoding="utf-8")
    for path in ("../../core/src/syncer.c", "../../core/src/yyjson.c", "../../core/include"):
        if path not in gyp:
            fail(f"native binding no longer compiles the bundled core path {path}")

    other_clients = [path.name for path in (ROOT / "clients").iterdir() if path.name != "ts"]
    if other_clients:
        fail(f"TypeScript target leaked other client roots: {sorted(other_clients)}")

    forbidden_names = {
        ".git",
        ".github",
        ".zed",
        "node_modules",
        "target",
        "build",
        "_build",
        ".dart_tool",
        ".tmp",
    }
    for path in ROOT.rglob("*"):
        if path.is_symlink():
            fail(f"source artifact contains a symlink: {path.relative_to(ROOT)}")
        if any(part in forbidden_names for part in path.relative_to(ROOT).parts):
            fail(f"generated/VCS state leaked into target: {path.relative_to(ROOT)}")

    bootstrap = (ROOT / "clients/ts/scripts/bootstrap-native-binding.mjs").read_text(encoding="utf-8")
    approved_binding_path = (
        "resolve(packageRoot, '..', '..', 'syncer.c', 'bindings', 'typescript')"
    )
    stale_sibling_path = (
        "resolve(packageRoot, '..', '..', '..', 'syncer.c', 'bindings', 'typescript')"
    )
    if approved_binding_path not in bootstrap:
        fail("client bootstrap must resolve syncer.c from the target or repository root")
    if stale_sibling_path in bootstrap:
        fail("client bootstrap still resolves the removed sibling-checkout layout")

    kind = "source stage" if lock_path.exists() else "packed/extracted artifact"
    print(
        f"TypeScript target passed ({kind}): self-contained client + native core + WASM, "
        f"client={client_sha[:12]} core={core_sha[:12]} publication=disabled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
