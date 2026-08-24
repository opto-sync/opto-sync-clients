#!/usr/bin/env python3
"""Verify split dev/prod age custody without reading any private identity."""

from __future__ import annotations

import re
import sys
from pathlib import Path

RULE = re.compile(r"^\s*-\s*path_regex:\s*(.+?)\s*$")
ITEM = re.compile(r"^\s*-\s*(\S+)\s*$")
EXACT = {r"^env/enc/dev\.env\.enc$": "dev", r"^env/enc/prod\.env\.enc$": "prod"}


def recipients(path: Path) -> dict[str, set[str]]:
    found = {"dev": set(), "prod": set()}
    current: str | None = None
    in_age = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        match = RULE.match(raw)
        if match:
            current = EXACT.get(match.group(1).strip().strip("\"'"))
            in_age = False
            continue
        if current and raw.strip() == "age:":
            in_age = True
            continue
        if in_age:
            match = ITEM.match(raw)
            if match and match.group(1).startswith("age1"):
                found[current].add(match.group(1))
                continue
            if raw.strip() and not raw.strip().startswith("#"):
                in_age = False
    return found


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify-sops-release-policy.py <.sops.yaml> <prod-profile>", file=sys.stderr)
        return 2
    policy = recipients(Path(sys.argv[1]))
    if sys.argv[2] != "prod":
        print("release profile must be prod", file=sys.stderr)
        return 1
    if len(policy["dev"]) < 2 or len(policy["prod"]) < 2:
        print("dev and prod each require at least two age recipients", file=sys.stderr)
        return 1
    if policy["dev"] == policy["prod"]:
        print("prod must use a distinct operator recipient set", file=sys.stderr)
        return 1
    if not policy["dev"].intersection(policy["prod"]):
        print("dev and prod must share a reviewed recovery recipient", file=sys.stderr)
        return 1
    print(f"production SOPS policy verified (dev recipients={len(policy['dev'])}, prod recipients={len(policy['prod'])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
