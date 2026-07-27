#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "targets/layouts.v1.json"


def fail(message: str) -> None:
    print(f"target-layouts: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    try:
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(str(exc))

    if spec.get("schemaVersion") != 1:
        fail("schemaVersion must be 1")
    if spec.get("coreResolutionPolicy") != "one certified core revision per installed release set":
        fail("core resolution policy must forbid multiple revisions")

    expected = {"typescript", "rust", "dart", "gleam"}
    targets = spec.get("targets", {})
    if set(targets) != expected:
        fail(f"target set must be {sorted(expected)}")

    for name, target in targets.items():
        root = target.get("root", "")
        if not root.startswith("clients/") or ".." in root:
            fail(f"{name}: invalid target root {root!r}")
        if target.get("strategy") not in {"bundled-source", "declared-zed-dependency", "reviewed-platform-artifact"}:
            fail(f"{name}: unsupported core strategy")
        core = target.get("core", [])
        if not core or any(".." in path or not path.startswith("syncer.c/") for path in core):
            fail(f"{name}: core paths must stay under syncer.c")
        consumer = target.get("consumer", [])
        if not consumer:
            fail(f"{name}: clean-room consumer commands are required")
        if not target.get("unsupportedBehavior"):
            fail(f"{name}: unsupported-platform behavior is required")

    invariants = set(spec.get("invariants", []))
    required_fragments = {
        "no manifest path may escape",
        "exact syncer.c source SHA",
        "must not resolve different core revisions",
        "double-packs byte-identically",
        "without Git metadata or sibling repositories",
    }
    for fragment in required_fragments:
        if not any(fragment in item for item in invariants):
            fail(f"missing invariant containing {fragment!r}")

    print("target layout specification passed for TypeScript, Rust, Dart, and Gleam")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
