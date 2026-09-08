#!/usr/bin/env python3
"""Fail closed unless the isolated TypeScript target and source package use one core."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tomllib
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


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot load {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path} must contain a JSON object")
    return value


def load_toml(path: Path) -> dict:
    try:
        with path.open("rb") as stream:
            value = tomllib.load(stream)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"cannot load {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path} must contain a TOML table")
    return value


def authoritative_package_coordinate() -> str:
    manifest = load_toml(ROOT / ".zpkg.toml")
    package = manifest.get("package")
    if not isinstance(package, dict):
        fail("root .zpkg.toml is missing [package]")
    org = package.get("org")
    name = package.get("name")
    version = package.get("version")
    if not all(isinstance(value, str) and value for value in (org, name, version)):
        fail("root .zpkg.toml package identity is incomplete")
    return f"{org}/{name}@{version}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("release_set", type=Path)
    args = parser.parse_args()

    release = load_json(args.release_set.resolve())
    if release.get("target") != "typescript":
        fail("release set does not describe the TypeScript target")

    expected_package = authoritative_package_coordinate()
    if release.get("wholeRepositoryPackage") != expected_package:
        fail(
            "release set does not name the authoritative whole-repository package: "
            f"expected {expected_package!r}, got {release.get('wholeRepositoryPackage')!r}"
        )
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
        f"package={expected_package} syncer.c={gitlink}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
