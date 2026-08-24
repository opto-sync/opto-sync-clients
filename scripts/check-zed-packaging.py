#!/usr/bin/env python3
"""Validate the whole-repository Zed package and reject unsafe target fan-out."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

SOURCE_ROOT = Path(__file__).resolve().parents[1]
VALIDATING_SOURCE = len(sys.argv) == 1
ROOT = SOURCE_ROOT if VALIDATING_SOURCE else Path(sys.argv[1]).resolve()
MAX_CONTRACT_BYTES = 4 * 1024 * 1024
EXPECTED_LIFECYCLE_PHASES = (
    "pre-install",
    "post-install",
    "pre-build",
    "post-build",
    "pre-pack",
    "pre-publish",
)


def read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def fail(message: str) -> None:
    print(f"zed-package: {message}", file=sys.stderr)
    raise SystemExit(1)


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def read_json(path: Path) -> Any:
    if path.is_symlink() or not path.is_file():
        fail(f"{path.relative_to(ROOT)} must be a regular file")
    if path.stat().st_size > MAX_CONTRACT_BYTES:
        fail(f"{path.relative_to(ROOT)} exceeds the contract size limit")
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
        )
    except (OSError, UnicodeError, ValueError) as error:
        fail(f"{path.relative_to(ROOT)} is not canonical readable JSON: {error}")


def read_digest(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        fail(f"{path.relative_to(ROOT)} must be a regular fingerprint file")
    try:
        digest = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as error:
        fail(f"{path.relative_to(ROOT)} is not a readable UTF-8 fingerprint: {error}")
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        fail(f"{path.relative_to(ROOT)} must contain one lowercase SHA-256 digest")
    return digest


def validate_client_contracts() -> None:
    clients = ROOT / "clients"
    surface_path = clients / "api-surface.json"
    schema_path = clients / "client-api.schema.json"
    manifest_path = clients / "contract-manifest.json"
    matrix_path = clients / "sdk-matrix.json"
    for path in (surface_path, schema_path, manifest_path, matrix_path):
        if path.is_symlink() or not path.is_file():
            fail(f"{path.relative_to(ROOT)} is missing or is not a regular file")

    surface = read_json(surface_path)
    schema = read_json(schema_path)
    contract_manifest = read_json(manifest_path)
    matrix = read_json(matrix_path)
    surface_digest = hashlib.sha256(surface_path.read_bytes()).hexdigest()
    declared_digest = read_digest(clients / ".api-surface.sha256")
    if declared_digest != surface_digest:
        fail(
            "clients/.api-surface.sha256 does not match the exact committed "
            "clients/api-surface.json bytes "
            f"(declared={declared_digest}, actual={surface_digest})"
        )

    coordinate = "opto-sync/opto-sync-clients"
    schema_id = "https://zpkg.tech/schemas/client-api.schema.json"
    if not isinstance(surface, dict) or surface.get("schemaVersion") != 1:
        fail("clients/api-surface.json must use schemaVersion 1")
    surface_package = surface.get("package")
    if not isinstance(surface_package, dict) or surface_package.get("coordinate") != coordinate:
        fail("clients/api-surface.json must use the canonical package coordinate")
    if not isinstance(schema, dict) or schema.get("$id") != schema_id:
        fail("clients/client-api.schema.json must use the pinned schema identifier")
    if not isinstance(contract_manifest, dict):
        fail("clients/contract-manifest.json must be a JSON object")
    if contract_manifest.get("coordinate") != coordinate:
        fail("clients/contract-manifest.json must use the canonical package coordinate")
    if contract_manifest.get("apiSurfaceSha256") != surface_digest:
        fail("clients/contract-manifest.json has a stale API-surface fingerprint")

    targets = contract_manifest.get("targets")
    if not isinstance(targets, list) or not targets:
        fail("clients/contract-manifest.json must declare at least one target")
    if contract_manifest.get("targetCount") != len(targets):
        fail("clients/contract-manifest.json targetCount does not match targets")

    manifest_targets: dict[str, dict[str, Any]] = {}
    for target in targets:
        if not isinstance(target, dict):
            fail("every contract-manifest target must be an object")
        name = target.get("target")
        directory = target.get("dir")
        if not isinstance(name, str) or not name:
            fail("every contract-manifest target must have a non-empty target name")
        if name in manifest_targets:
            fail(f"contract-manifest target {name!r} is duplicated")
        if not isinstance(directory, str):
            fail(f"contract-manifest target {name!r} must declare a directory")
        relative = Path(directory)
        if relative.is_absolute() or ".." in relative.parts or relative.parts[:1] != ("clients",):
            fail(f"contract-manifest target {name!r} has an unsafe directory")
        target_dir = ROOT / relative
        if target_dir.is_symlink() or not target_dir.is_dir():
            fail(f"contract-manifest target {name!r} directory is missing or indirect")
        if target.get("coordinate") != coordinate:
            fail(f"contract-manifest target {name!r} has the wrong coordinate")
        if target.get("schemaId") != schema_id or target.get("schemaVersion") != 1:
            fail(f"contract-manifest target {name!r} has the wrong schema contract")
        if not isinstance(target.get("runtime"), str) or not target["runtime"]:
            fail(f"contract-manifest target {name!r} must declare a runtime")
        if not isinstance(target.get("zedTarget"), str) or not target["zedTarget"]:
            fail(f"contract-manifest target {name!r} must declare a Zed target")
        if target.get("apiSurface") != "clients/api-surface.json":
            fail(f"contract-manifest target {name!r} has the wrong API-surface path")
        if target.get("apiSurfaceSha256") != surface_digest:
            fail(f"contract-manifest target {name!r} has a stale API-surface fingerprint")

        target_contract = read_json(target_dir / ".zed-client-contract.json")
        expected_contract = {key: value for key, value in target.items() if key != "dir"}
        if target_contract != expected_contract:
            fail(f"contract-manifest target {name!r} disagrees with its client contract")
        if read_digest(target_dir / ".zed-api-surface.sha256") != surface_digest:
            fail(f"contract-manifest target {name!r} has a stale fingerprint file")
        manifest_targets[name] = target

    if not isinstance(matrix, dict) or matrix.get("schema_version") != 1:
        fail("clients/sdk-matrix.json must use schema_version 1")
    if matrix.get("api_surface") != "clients/api-surface.json":
        fail("clients/sdk-matrix.json has the wrong API-surface path")
    if matrix.get("api_schema") != "clients/client-api.schema.json":
        fail("clients/sdk-matrix.json has the wrong API-schema path")
    if matrix.get("standard_target_count") != len(manifest_targets):
        fail("clients/sdk-matrix.json standard_target_count does not match targets")
    minimum_targets = matrix.get("minimum_targets")
    if not isinstance(minimum_targets, int) or len(manifest_targets) < minimum_targets:
        fail("clients/sdk-matrix.json does not meet its minimum target count")
    matrix_targets = matrix.get("targets")
    if not isinstance(matrix_targets, dict) or set(matrix_targets) != set(manifest_targets):
        fail("clients/sdk-matrix.json target names disagree with the contract manifest")
    for name, target in manifest_targets.items():
        expected = {
            "dir": target["dir"],
            "runtime": target["runtime"],
            "zed_target": target["zedTarget"],
        }
        if matrix_targets[name] != expected:
            fail(f"clients/sdk-matrix.json target {name!r} disagrees with the contract manifest")


def main() -> int:
    manifest_path = ROOT / ".zpkg.toml"
    if not manifest_path.is_file():
        fail(".zpkg.toml is missing")
    manifest = read_toml(manifest_path)
    package = manifest.get("package", {})

    expected = {
        "org": "opto-sync",
        "name": "opto-sync-clients",
        "version": "0.4.0",
        "license": "MIT",
    }
    for key, value in expected.items():
        if package.get(key) != value:
            fail(f"package.{key} must be {value!r}, got {package.get(key)!r}")
    repository = package.get("repository", {})
    if repository.get("url") != "https://github.com/opto-sync/opto-sync-clients":
        fail("package.repository.url must be the canonical GitHub repository")

    if "lifecycle" in manifest:
        fail("lifecycle hooks must remain convention files until zed validate accepts the manifest field")
    if VALIDATING_SOURCE:
        for phase in EXPECTED_LIFECYCLE_PHASES:
            hook = ROOT / ".zed" / phase
            if hook.is_symlink() or not hook.is_file():
                fail(f".zed/{phase} must be a regular file")
            if hook.stat().st_mode & 0o111 == 0:
                fail(f".zed/{phase} must be executable")
            if not hook.read_text(encoding="utf-8").startswith("#!/usr/bin/env sh\nset -eu\n"):
                fail(f".zed/{phase} must use the portable fail-closed shell header")

    dependencies = manifest.get("dependencies", {})
    if dependencies:
        fail("unreleased Zed dependencies must not be declared")
    if any(name.startswith("opto-sync/syncer") for name in dependencies):
        fail("the bundled pinned core must not be duplicated as a Zed dependency")

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

    validate_client_contracts()

    layout_check = ROOT / "scripts/check-package-layout.py"
    if not layout_check.is_file():
        fail("scripts/check-package-layout.py is missing from the package")
    subprocess.run([sys.executable, str(layout_check)], cwd=ROOT, check=True)

    kind = "source repository" if VALIDATING_SOURCE else "installed artifact"
    print(f"Zed package contract passed for {kind}: one package, one pinned native core")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
