#!/usr/bin/env python3
"""Verify the clean-room layout plus the source repository's pinned gitlink."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "syncer.c"
PACKAGE_CHECK = ROOT / "scripts/check-package-layout.py"


def fail(message: str) -> None:
    print(f"dependency-boundary: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def main() -> int:
    # The same path and package-lock assertions must work after Zed removes Git
    # metadata, so keep them in a separate clean-room check and run it first.
    subprocess.run([sys.executable, str(PACKAGE_CHECK)], cwd=ROOT, check=True)

    modules_path = ROOT / ".gitmodules"
    if not modules_path.is_file():
        fail(".gitmodules is missing")
    modules = modules_path.read_text(encoding="utf-8")
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

    print(f"dependency boundary ok: syncer.c pinned at {pinned_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
