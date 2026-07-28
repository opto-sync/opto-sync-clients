#!/usr/bin/env python3
"""Assemble the isolated TypeScript Zed target from reviewed repository sources."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {
    ".git",
    ".github",
    ".zed",
    "node_modules",
    "target",
    "build",
    "_build",
    ".dart_tool",
    "coverage",
    "playwright-report",
    "test-results",
    ".tmp",
}


def fail(message: str) -> None:
    print(f"stage-typescript-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(cwd), *args], text=True, stderr=subprocess.STDOUT
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"git {' '.join(args)} failed: {exc.output.strip()}")


def ignore(directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in IGNORED}


def copy_tree(source: Path, destination: Path) -> None:
    if not source.is_dir():
        fail(f"required source directory is missing: {source.relative_to(ROOT)}")
    shutil.copytree(source, destination, ignore=ignore)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        fail("output must be outside the source repository")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    client_sha = git("rev-parse", "HEAD")
    gitlink_sha = git("rev-parse", "HEAD:syncer.c")
    nested_sha = git("rev-parse", "HEAD", cwd=ROOT / "syncer.c")
    if gitlink_sha != nested_sha:
        fail(
            "initialized syncer.c differs from the recorded gitlink: "
            f"gitlink={gitlink_sha} nested={nested_sha}"
        )

    copy_tree(ROOT / "clients/ts", output / "clients/ts")
    # Client build output must be reproduced by the extracted consumer. The
    # checked-in WASM distribution, in contrast, is a required source artifact.
    shutil.rmtree(output / "clients/ts/dist", ignore_errors=True)

    # Zed source packing deliberately omits conventional test directories. Keep
    # the clean-room consumer corpus under an explicit smoke/ path so the exact
    # packed artifact can prove native, IndexedDB, and Chromium behavior.
    test_source = output / "clients/ts/test"
    smoke_target = output / "clients/ts/smoke"
    if not test_source.is_dir():
        fail("clients/ts/test is missing from the source tree")
    if smoke_target.exists():
        fail("clients/ts/smoke already exists; staging would overwrite it")
    test_source.rename(smoke_target)

    # The staged artifact owns its smoke path, so its public npm commands must
    # remain runnable after extraction rather than pointing at the omitted
    # repository-only test/ location.
    package_path = output / "clients/ts/package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = package.setdefault("scripts", {})
    scripts["test"] = "npm run build && npm run test:node && npm run test:browser"
    scripts["test:node"] = (
        "node --test smoke/queue.test.js smoke/reconcile.test.js"
    )
    scripts["test:browser"] = "node --test smoke/browser-e2e.test.mjs"
    write(package_path, json.dumps(package, indent=2) + "\n")

    copy_tree(ROOT / "syncer.c/core/include", output / "syncer.c/core/include")
    copy_tree(ROOT / "syncer.c/core/src", output / "syncer.c/core/src")
    copy_tree(
        ROOT / "syncer.c/bindings/typescript",
        output / "syncer.c/bindings/typescript",
    )
    copy_tree(ROOT / "syncer.c/bindings/wasm", output / "syncer.c/bindings/wasm")

    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    validator = ROOT / "scripts/check-typescript-target.py"
    if not validator.is_file():
        fail("scripts/check-typescript-target.py is missing")
    (output / "scripts").mkdir()
    shutil.copy2(validator, output / "scripts/check-typescript-target.py")

    write(output / "syncer.c/SOURCE_SHA", nested_sha + "\n")
    release_set = {
        "schemaVersion": 1,
        "releaseSetId": "opto-sync-typescript-target-candidate",
        "target": "typescript",
        "package": "opto-sync/opto-sync-client-typescript",
        "clientVersion": "0.2.0",
        "syncerVersion": "0.2.1",
        "clientSourceSha": client_sha,
        "syncerSourceSha": nested_sha,
        "coreResolution": "bundled-source",
        "publicationEnabled": False,
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.2.0",
        "coexistenceRule": "all installed opto-sync targets must resolve the same syncerSourceSha",
    }
    write(
        output / "release-set.json",
        json.dumps(release_set, indent=2, sort_keys=True) + "\n",
    )

    write(
        output / ".zpkg.toml",
        '''[package]
org = "opto-sync"
name = "opto-sync-client-typescript"
version = "0.2.0"
description = "Self-contained TypeScript opto-sync client prototype with one pinned native/WASM core"
license = "MIT"
keywords = ["sync", "offline-first", "typescript", "indexeddb", "wasm"]

[package.repository]
vcs = "git"
url = "https://github.com/opto-sync/opto-sync-clients"

[publish]
include_readme = true
tag_format = "typescript-v{version}"
smoke_test = 'python3 "$ZED_PKG_TEST_TARGET/scripts/check-typescript-target.py" "$ZED_PKG_TEST_TARGET"'
exclude = [
  ".zed/**",
  "**/node_modules/**",
  "**/build/**",
  "**/target/**",
  "**/coverage/**",
  "**/.tmp/**",
  "clients/ts/dist/**",
]

[scripts]
test = "python3 scripts/check-typescript-target.py ."
''',
    )
    write(output / ".zpkg.lock", "version = 1\n")
    write(
        output / "README.md",
        f'''# opto-sync TypeScript target prototype

This clean-room source target contains only:

- `clients/ts` (`@opto-sync/client` 0.2.0);
- `clients/ts/smoke` (credential-free extracted-artifact consumer tests);
- `syncer.c/core`;
- `syncer.c/bindings/typescript` (`@opto-sync/syncer` 0.2.1); and
- `syncer.c/bindings/wasm` (`@opto-sync/syncer-wasm` 0.2.1).

Source identity:

- client commit: `{client_sha}`
- syncer.c commit: `{nested_sha}`

Publication is intentionally disabled by `release-set.json`. This prototype must
pass deterministic double-pack, extracted blank-consumer, native Node, and real
browser/WASM tests before it can be wired into the coordinated release set.
''',
    )

    # Reject accidental copies of generated/VCS state before the Zed pack step.
    forbidden = []
    for path in output.rglob("*"):
        relative = path.relative_to(output)
        if path.is_symlink() or any(part in IGNORED for part in relative.parts):
            forbidden.append(str(relative))
    if (output / "clients/ts/dist").exists():
        forbidden.append("clients/ts/dist")
    if (output / "clients/ts/test").exists():
        forbidden.append("clients/ts/test")
    if forbidden:
        fail("staged target contains forbidden state: " + ", ".join(forbidden))

    subprocess.run(
        [sys.executable, str(output / "scripts/check-typescript-target.py"), str(output)],
        check=True,
    )
    print(
        f"staged TypeScript target at {output}: "
        f"client={client_sha[:12]} core={nested_sha[:12]}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
