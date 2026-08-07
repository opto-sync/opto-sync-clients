#!/usr/bin/env python3
"""Fail closed when Actions or cross-repository checkouts can move silently."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github/workflows"
SHA = re.compile(r"^[0-9a-f]{40}$")
REMOTE_USE = re.compile(r"(?m)^\s*(?:-\s*)?uses:\s*([^\s#]+)")
CANARY_MAIN_ALLOWLIST = {"upstream-main-canary.yml"}


def main() -> int:
    failures: list[str] = []
    action_count = 0
    for path in sorted((*WORKFLOWS.glob("*.yml"), *WORKFLOWS.glob("*.yaml"))):
        text = path.read_text(encoding="utf-8")
        checkout_count = 0
        for match in REMOTE_USE.finditer(text):
            uses = match.group(1)
            if uses.startswith(("./", "docker://")):
                continue
            action_count += 1
            if uses.startswith("actions/checkout@"):
                checkout_count += 1
            ref = uses.rsplit("@", 1)[-1] if "@" in uses else ""
            if not SHA.fullmatch(ref):
                failures.append(
                    f"{path.relative_to(ROOT)}: remote action must use a 40-hex "
                    f"commit, found {uses}"
                )

        credential_opt_outs = len(
            re.findall(r"(?m)^\s*persist-credentials:\s*false\s*$", text)
        )
        if credential_opt_outs < checkout_count:
            failures.append(
                f"{path.relative_to(ROOT)}: every checkout must disable persisted "
                f"credentials ({credential_opt_outs}/{checkout_count})"
            )

        if (
            path.name not in CANARY_MAIN_ALLOWLIST
            and re.search(r"(?m)^\s*ref:\s*(?:main|HEAD)\s*(?:#.*)?$", text)
        ):
            failures.append(
                f"{path.relative_to(ROOT)}: cross-repository checkouts must not "
                "follow main or HEAD"
            )

    if failures:
        raise SystemExit("\n".join(failures))
    print(
        "workflow supply-chain contract passed: "
        f"{action_count} remote actions are immutable and checkout credentials "
        "are disabled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
