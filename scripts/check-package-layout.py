#!/usr/bin/env python3
"""Validate the clean-room source layout without requiring Git metadata."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FILES = [
    ROOT / "clients/ts/package.json",
    ROOT / "clients/ts/package-lock.json",
    ROOT / "clients/dart/pubspec.yaml",
    ROOT / "clients/rust/Cargo.toml",
    ROOT / "clients/gleam/gleam.toml",
    ROOT / "clients/gleam/manifest.toml",
]

EXPECTED = {
    "clients/ts/package.json": [
        "file:../../syncer.c/bindings/typescript",
        "file:../../syncer.c/bindings/wasm",
    ],
    "clients/ts/package-lock.json": [
        "file:../../syncer.c/bindings/typescript",
        "file:../../syncer.c/bindings/wasm",
        "../../syncer.c/bindings/typescript",
        "../../syncer.c/bindings/wasm",
    ],
    "clients/dart/pubspec.yaml": ["../../syncer.c/bindings/dart"],
    "clients/rust/Cargo.toml": ["../../syncer.c/bindings/rust"],
    "clients/gleam/gleam.toml": ["../../syncer.c/bindings/gleam"],
    "clients/gleam/manifest.toml": ["../../syncer.c/bindings/gleam"],
}

PATH_RE = re.compile(r"(?:file:)?(\.\./[^\"'\s,}\]]+)")


def fail(message: str) -> None:
    print(f"package-layout: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    web_e2e = ROOT / "clients/dart/tool/web_e2e.mjs"
    required_source = [
        ROOT / ".zpkg.toml",
        ROOT / "LICENSE",
        ROOT / "README.md",
        web_e2e,
        ROOT / "schema/opto-sync-envelope.schema.json",
        ROOT / "schema/opto-sync-sdk-api.schema.json",
        ROOT / "schema/opto-sync-sdk-api.v1.json",
        ROOT / "schema/opto-sync-telemetry-event.schema.json",
        ROOT / "schema/check-sdk-api-contract.mjs",
        ROOT / "syncer.c/core/include/syncer.h",
        ROOT / "syncer.c/core/src/syncer.c",
        ROOT / "syncer.c/bindings/typescript/package.json",
        ROOT / "syncer.c/bindings/wasm/package.json",
        ROOT / "syncer.c/bindings/rust/Cargo.toml",
    ]
    for path in required_source:
        if not path.is_file():
            fail(f"required package file is missing: {path.relative_to(ROOT)}")

    web_e2e_text = web_e2e.read_text(encoding="utf-8")
    if "resolve(packageRoot, '../../..')" in web_e2e_text:
        fail("Dart web E2E still resolves syncer.c as a mutable sibling checkout")
    if "resolve(packageRoot, '../..')" not in web_e2e_text:
        fail("Dart web E2E must derive the repository root from clients/dart")
    if "resolve(repositoryRoot, 'syncer.c/bindings/wasm')" not in web_e2e_text:
        fail("Dart web E2E must load WASM from the pinned root syncer.c submodule")

    for path in FILES:
        if not path.is_file():
            fail(f"required dependency manifest is missing: {path.relative_to(ROOT)}")
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        if "../../../syncer.c" in text:
            fail(f"{rel} still escapes to a mutable sibling syncer.c checkout")
        for expected in EXPECTED[rel]:
            if expected not in text:
                fail(f"{rel} is missing the pinned in-repository path {expected!r}")
        for match in PATH_RE.finditer(text):
            raw = match.group(1)
            resolved = (path.parent / raw).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                fail(f"{rel} contains an out-of-package path dependency: {raw}")

    package = json.loads((ROOT / "clients/ts/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "clients/ts/package-lock.json").read_text(encoding="utf-8"))
    locked_root = lock["packages"][""]
    for section in ("dependencies", "optionalDependencies"):
        if package.get(section, {}) != locked_root.get(section, {}):
            fail(f"TypeScript package-lock root {section} does not match package.json")

    print("package layout ok: all clients resolve the bundled pinned core")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
