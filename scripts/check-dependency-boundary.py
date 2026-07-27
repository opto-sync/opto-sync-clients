#!/usr/bin/env python3
"""Verify every client resolves syncer.c inside this repository's pinned gitlink."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "syncer.c"

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
    print(f"dependency-boundary: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def main() -> int:
    modules = (ROOT / ".gitmodules").read_text(encoding="utf-8")
    if "path = syncer.c" not in modules:
        fail(".gitmodules must declare syncer.c at the repository root")
    if "url = https://github.com/opto-sync/syncer.c.git" not in modules:
        fail("syncer.c submodule URL must use the canonical public HTTPS repository")

    stage = git("ls-files", "--stage", "syncer.c")
    parts = stage.split()
    if len(parts) < 4 or parts[0] != "160000":
        fail("syncer.c must be a real mode-160000 gitlink, not a copied directory")
    pinned_sha = parts[1]

    if not (CORE / "core/include/syncer.h").is_file():
        fail("syncer.c is not initialized; run `git submodule update --init --recursive`")
    actual_sha = git("rev-parse", "HEAD", cwd=CORE)
    if actual_sha != pinned_sha:
        fail(f"initialized syncer.c is {actual_sha}, but the gitlink pins {pinned_sha}")

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
                fail(f"{rel} contains an out-of-repository path dependency: {raw}")

    package = json.loads((ROOT / "clients/ts/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "clients/ts/package-lock.json").read_text(encoding="utf-8"))
    locked_root = lock["packages"][""]
    for section in ("dependencies", "optionalDependencies"):
        if package.get(section, {}) != locked_root.get(section, {}):
            fail(f"TypeScript package-lock root {section} does not match package.json")

    print(f"dependency boundary ok: syncer.c pinned at {pinned_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
