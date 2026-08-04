#!/usr/bin/env python3
"""Validate one or more .opto-sync.json adoption manifests without dependencies."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "opto-sync.adoption.v1"
PACKAGE = "opto-sync/opto-sync-clients"
REPOSITORY = "https://github.com/opto-sync/opto-sync-clients"
PROJECT_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SCOPE_RE = re.compile(r"^[A-Za-z0-9_.:/-]+$")

ROOT_KEYS = {
    "schemaVersion",
    "project",
    "clientPackage",
    "languages",
    "dataScopes",
    "localStores",
    "transports",
    "writeStrategies",
    "conflictPolicy",
    "background",
    "security",
    "rollout",
    "notes",
}
REQUIRED_ROOT = ROOT_KEYS - {"notes"}
LANGUAGES = {"dart", "gleam", "rust", "typescript"}
LOCAL_STORES = {"indexeddb", "memory", "sqlite"}
TRANSPORTS = {"broadcast-channel", "http", "supabase-realtime", "tcp", "websocket"}
WRITE_STRATEGIES = {"local-durable", "local-then-remote", "remote-confirmed"}
ARRAY_STRATEGIES = {"append", "mergeByIndex", "mergeByKey", "replace", "union"}
ROLLOUT_PHASES = {"declared", "local-queue", "transport", "background", "production"}
SENSITIVE_KEY_FRAGMENTS = ("secret", "token", "password", "privatekey", "private_key")


class ManifestError(ValueError):
    pass


def fail(path: str, message: str) -> None:
    raise ManifestError(f"{path}: {message}")


def require_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(path, "must be an object")
    return value


def require_bool(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        fail(path, "must be a boolean")
    return value


def require_string(value: Any, path: str, *, maximum: int = 2000) -> str:
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > maximum:
        fail(path, f"must be a non-empty string no longer than {maximum} bytes")
    if any(ord(character) < 32 for character in value):
        fail(path, "must not contain control characters")
    return value


def require_exact_keys(
    value: dict[str, Any], path: str, required: set[str], optional: set[str] | None = None
) -> None:
    optional = optional or set()
    missing = required - value.keys()
    unknown = value.keys() - required - optional
    if missing:
        fail(path, f"missing keys: {', '.join(sorted(missing))}")
    if unknown:
        fail(path, f"unknown keys: {', '.join(sorted(unknown))}")


def require_unique_string_list(
    value: Any,
    path: str,
    *,
    allowed: set[str] | None = None,
    pattern: re.Pattern[str] | None = None,
    maximum_item_bytes: int = 128,
) -> list[str]:
    if not isinstance(value, list) or not value:
        fail(path, "must be a non-empty array")
    result: list[str] = []
    for index, item in enumerate(value):
        item = require_string(item, f"{path}[{index}]", maximum=maximum_item_bytes)
        if allowed is not None and item not in allowed:
            fail(f"{path}[{index}]", f"unsupported value {item!r}")
        if pattern is not None and pattern.fullmatch(item) is None:
            fail(f"{path}[{index}]", f"invalid value {item!r}")
        result.append(item)
    if len(set(result)) != len(result):
        fail(path, "must not contain duplicates")
    return result


def reject_sensitive_keys(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.lower().replace("-", "").replace(" ", "")
            if any(fragment in normalized for fragment in SENSITIVE_KEY_FRAGMENTS):
                if key != "secretsInManifest":
                    fail(f"{path}.{key}", "manifest keys must not carry credentials")
            reject_sensitive_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_sensitive_keys(child, f"{path}[{index}]")


def validate_manifest(document: Any) -> dict[str, Any]:
    root = require_object(document, "$")
    require_exact_keys(root, "$", REQUIRED_ROOT, {"notes"})
    reject_sensitive_keys(root)

    if root["schemaVersion"] != SCHEMA_VERSION:
        fail("$.schemaVersion", f"must equal {SCHEMA_VERSION!r}")

    project = require_string(root["project"], "$.project", maximum=256)
    if PROJECT_RE.fullmatch(project) is None:
        fail("$.project", "must use owner/repository form")

    client = require_object(root["clientPackage"], "$.clientPackage")
    require_exact_keys(client, "$.clientPackage", {"package", "repository", "version", "commit"})
    if client["package"] != PACKAGE:
        fail("$.clientPackage.package", f"must equal {PACKAGE!r}")
    if client["repository"] != REPOSITORY:
        fail("$.clientPackage.repository", f"must equal {REPOSITORY!r}")
    version = require_string(client["version"], "$.clientPackage.version", maximum=32)
    if VERSION_RE.fullmatch(version) is None:
        fail("$.clientPackage.version", "must be an exact semantic version")
    commit = require_string(client["commit"], "$.clientPackage.commit", maximum=40)
    if COMMIT_RE.fullmatch(commit) is None:
        fail("$.clientPackage.commit", "must be an exact lowercase 40-character commit SHA")

    require_unique_string_list(root["languages"], "$.languages", allowed=LANGUAGES)
    require_unique_string_list(root["dataScopes"], "$.dataScopes", pattern=SCOPE_RE)
    require_unique_string_list(root["localStores"], "$.localStores", allowed=LOCAL_STORES)
    require_unique_string_list(root["transports"], "$.transports", allowed=TRANSPORTS)
    require_unique_string_list(
        root["writeStrategies"], "$.writeStrategies", allowed=WRITE_STRATEGIES
    )

    conflict = require_object(root["conflictPolicy"], "$.conflictPolicy")
    require_exact_keys(
        conflict,
        "$.conflictPolicy",
        {"arrayStrategy", "resolveByTimestamp", "lwwKeys", "tombstones"},
        {"arrayMatchKeys"},
    )
    if conflict["arrayStrategy"] not in ARRAY_STRATEGIES:
        fail("$.conflictPolicy.arrayStrategy", "unsupported array merge strategy")
    require_bool(conflict["resolveByTimestamp"], "$.conflictPolicy.resolveByTimestamp")
    require_unique_string_list(conflict["lwwKeys"], "$.conflictPolicy.lwwKeys")
    if "arrayMatchKeys" in conflict:
        require_unique_string_list(
            conflict["arrayMatchKeys"], "$.conflictPolicy.arrayMatchKeys"
        )
    if conflict["tombstones"] is not True:
        fail("$.conflictPolicy.tombstones", "must be true")

    background = require_object(root["background"], "$.background")
    background_keys = {"webServiceWorker", "mobileWorker", "desktopWorker"}
    require_exact_keys(background, "$.background", background_keys)
    for key in background_keys:
        require_bool(background[key], f"$.background.{key}")

    security = require_object(root["security"], "$.security")
    security_keys = {"authenticatedTransport", "encryptedAtRest", "secretsInManifest"}
    require_exact_keys(security, "$.security", security_keys)
    if security["authenticatedTransport"] is not True:
        fail("$.security.authenticatedTransport", "must be true")
    require_bool(security["encryptedAtRest"], "$.security.encryptedAtRest")
    if security["secretsInManifest"] is not False:
        fail("$.security.secretsInManifest", "must be false")

    rollout = require_object(root["rollout"], "$.rollout")
    require_exact_keys(rollout, "$.rollout", {"phase", "owners"})
    if rollout["phase"] not in ROLLOUT_PHASES:
        fail("$.rollout.phase", "unsupported rollout phase")
    require_unique_string_list(rollout["owners"], "$.rollout.owners")

    if "notes" in root:
        require_string(root["notes"], "$.notes", maximum=2000)
    return root


def validate_file(path: Path) -> None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ManifestError(f"{path}: file does not exist") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"{path}:{error.lineno}:{error.colno}: invalid JSON: {error.msg}") from error
    validate_manifest(document)


def discover(root: Path) -> list[Path]:
    direct = root / ".opto-sync.json"
    if direct.is_file():
        return [direct]
    return sorted(root.rglob(".opto-sync.json"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    paths = args.paths or discover(args.root)
    if not paths:
        print("adoption-manifest: no .opto-sync.json files found", file=sys.stderr)
        return 2

    failed = False
    for path in paths:
        try:
            validate_file(path)
        except ManifestError as error:
            failed = True
            print(f"adoption-manifest: {error}", file=sys.stderr)
        else:
            print(f"adoption-manifest: ok {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
