#!/usr/bin/env python3
"""Fail closed unless the isolated TypeScript target and source package use one core."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"typescript-one-core: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(cwd), *args], text=True, stderr=subprocess.STDOUT
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"git {' '.join(args)} failed: {exc.output.strip()}")


def load(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot load {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path} must contain a JSON object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("release_set", type=Path)
    args = parser.parse_args()

    release = load(args.release_set.resolve())
    if release.get("target") != "typescript":
        fail("release set does not describe the TypeScript target")
    if release.get("wholeRepositoryPackage") != "opto-sync/opto-sync-clients@0.2.0":
        fail("release set does not name the authoritative whole-repository package")
    if release.get("coexistenceRule") != (
        "all installed opto-sync targets must resolve the same syncerSourceSha"
    ):
        fail("release set does not declare the one-core coexistence rule")

    gitlink = git("rev-parse", "HEAD:syncer.c")
    nested = git("rev-parse", "HEAD", cwd=ROOT / "syncer.c")
    target = release.get("syncerSourceSha")
    identities = {
        "wholeRepositoryGitlink": gitlink,
        "wholeRepositoryNestedCore": nested,
        "typescriptTargetCore": target,
    }
    if not isinstance(target, str):
        fail("release set has no syncerSourceSha")
    if len(set(identities.values())) != 1:
        fail(
            "multiple syncer.c revisions would coexist: "
            + ", ".join(f"{name}={sha}" for name, sha in identities.items())
        )

    print(
        "TypeScript/whole-repository one-core preflight passed: "
        f"syncer.c={gitlink}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
