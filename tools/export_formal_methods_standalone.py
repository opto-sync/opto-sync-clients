#!/usr/bin/env python3
"""Export the reusable formal-methods incubator without product code.

The export contract is deliberately whitelist-based. The exporter copies exact
tracked bytes, rejects symlinks/submodules/non-files, and emits deterministic
source provenance so a later standalone repository bootstrap can prove that no
protocol or result bytes changed during extraction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any

CONTRACT_PATH = Path("formal/standalone-export.v1.json")


def fail(message: str) -> "NoReturn":
    raise SystemExit(message)


def run_git(root: Path, *args: str) -> bytes:
    completed = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        fail(
            f"git {' '.join(args)} failed with exit {completed.returncode}: "
            f"{completed.stderr.decode('utf-8', errors='replace').strip()}"
        )
    return completed.stdout


def repository_root() -> Path:
    root = run_git(Path.cwd(), "rev-parse", "--show-toplevel").decode().strip()
    return Path(root).resolve()


def load_contract(root: Path) -> dict[str, Any]:
    path = root / CONTRACT_PATH
    try:
        contract = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read standalone export contract {path}: {error}")
    if contract.get("schemaVersion") != 1:
        fail("standalone export contract schemaVersion must be 1")
    for field in ("targetRepository", "sourceRepository", "include", "forbidPrefixes", "provenanceFile"):
        if field not in contract:
            fail(f"standalone export contract is missing {field}")
    if not isinstance(contract["include"], list) or not contract["include"]:
        fail("standalone export include list must be non-empty")
    return contract


def validate_contract_path(value: str, field: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        fail(f"invalid {field} path {value!r}")
    return path


def tracked_files(root: Path, contract: dict[str, Any]) -> list[PurePosixPath]:
    include = [str(validate_contract_path(value, "include")) for value in contract["include"]]
    output = run_git(root, "ls-files", "-z", "--", *include)
    files = sorted(
        PurePosixPath(raw.decode("utf-8"))
        for raw in output.split(b"\0")
        if raw
    )
    if not files:
        fail("standalone export contract matched no tracked files")

    matched = {entry: False for entry in include}
    for file_path in files:
        rendered = str(file_path)
        for entry in include:
            if rendered == entry or rendered.startswith(entry.rstrip("/") + "/"):
                matched[entry] = True
        for prefix in contract["forbidPrefixes"]:
            forbidden = str(validate_contract_path(prefix.rstrip("/"), "forbidPrefixes"))
            if rendered == forbidden or rendered.startswith(forbidden + "/"):
                fail(f"export contract selected forbidden product path: {rendered}")
    missing = sorted(entry for entry, present in matched.items() if not present)
    if missing:
        fail("standalone export entries matched no tracked files: " + ", ".join(missing))
    return files


def validate_source_file(root: Path, relative: PurePosixPath) -> Path:
    source = root.joinpath(*relative.parts)
    try:
        info = source.lstat()
    except OSError as error:
        fail(f"cannot stat export source {relative}: {error}")
    if stat.S_ISLNK(info.st_mode):
        fail(f"standalone export refuses symlink: {relative}")
    if not stat.S_ISREG(info.st_mode):
        fail(f"standalone export requires regular tracked files: {relative}")
    resolved = source.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        fail(f"standalone export source escapes repository: {relative}")
    return source


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_commit(root: Path) -> str:
    return run_git(root, "rev-parse", "HEAD").decode().strip()


def source_tree(root: Path) -> str:
    return run_git(root, "rev-parse", "HEAD^{tree}").decode().strip()


def ensure_clean_destination(destination: Path) -> None:
    if destination.exists():
        if not destination.is_dir() or any(destination.iterdir()):
            fail(f"destination must be absent or empty: {destination}")
    else:
        destination.mkdir(parents=True)


def export(root: Path, destination: Path, contract: dict[str, Any]) -> dict[str, Any]:
    ensure_clean_destination(destination)
    files = tracked_files(root, contract)
    provenance_files: list[dict[str, Any]] = []

    for relative in files:
        source = validate_source_file(root, relative)
        data = source.read_bytes()
        target = destination.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(data)
        provenance_files.append(
            {
                "path": str(relative),
                "sha256": sha256(data),
                "size": len(data),
            }
        )

    provenance = {
        "schemaVersion": 1,
        "sourceRepository": contract["sourceRepository"],
        "sourceCommit": source_commit(root),
        "sourceTree": source_tree(root),
        "targetRepository": contract["targetRepository"],
        "contract": str(CONTRACT_PATH),
        "contractSha256": sha256((root / CONTRACT_PATH).read_bytes()),
        "files": provenance_files,
    }
    encoded = (json.dumps(provenance, indent=2, sort_keys=True) + "\n").encode("utf-8")
    provenance_name = validate_contract_path(contract["provenanceFile"], "provenanceFile")
    provenance_path = destination.joinpath(*provenance_name.parts)
    provenance_path.parent.mkdir(parents=True, exist_ok=True)
    provenance_path.write_bytes(encoded)
    return provenance


def check(root: Path, contract: dict[str, Any]) -> None:
    files = tracked_files(root, contract)
    for relative in files:
        validate_source_file(root, relative)
    print(
        json.dumps(
            {
                "contract": str(CONTRACT_PATH),
                "sourceCommit": source_commit(root),
                "sourceTree": source_tree(root),
                "trackedFiles": len(files),
            },
            sort_keys=True,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate the contract without exporting")
    parser.add_argument("--destination", type=Path, help="empty destination directory")
    args = parser.parse_args()

    if args.check == (args.destination is not None):
        parser.error("choose exactly one of --check or --destination")

    root = repository_root()
    contract = load_contract(root)
    if args.check:
        check(root, contract)
        return

    destination = args.destination.resolve()
    try:
        destination.relative_to(root)
    except ValueError:
        pass
    else:
        fail("standalone export destination must be outside the source repository")
    provenance = export(root, destination, contract)
    print(json.dumps(provenance, sort_keys=True))


if __name__ == "__main__":
    main()
