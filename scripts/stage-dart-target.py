#!/usr/bin/env python3
"""Stage the self-contained Dart/Flutter Zed target from a recursive checkout."""

from __future__ import annotations

import hashlib
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
    ".dart_tool",
    "node_modules",
    "deps",
    "_build",
    "build",
    "target",
    ".tmp",
}


def fail(message: str) -> None:
    print(f"stage-dart-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(cwd), *args], text=True, stderr=subprocess.STDOUT
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"git {' '.join(args)} failed: {exc.output.strip()}")


def copy_tree(
    source: Path, destination: Path, *, ignored_names: frozenset[str] = frozenset()
) -> None:
    if not source.is_dir():
        fail(f"required source directory is missing: {source.relative_to(ROOT)}")
    shutil.copytree(
        source,
        destination,
        ignore=lambda _directory, names: {
            name for name in names if name in IGNORED or name in ignored_names
        },
    )


def copy_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        fail(f"required source file is missing: {source.relative_to(ROOT)}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: stage-dart-target.py OUTPUT_DIRECTORY")
    output = Path(sys.argv[1]).resolve()
    if output == ROOT or ROOT in output.parents:
        fail("output must be outside the source repository")
    if output.exists():
        fail(f"refusing to replace existing output path: {output}")
    output.mkdir(parents=True)

    client_sha = git("rev-parse", "HEAD")
    gitlink_sha = git("rev-parse", "HEAD:syncer.c")
    nested_sha = git("rev-parse", "HEAD", cwd=ROOT / "syncer.c")
    if gitlink_sha != nested_sha:
        fail(
            "initialized syncer.c differs from the recorded gitlink: "
            f"gitlink={gitlink_sha} nested={nested_sha}"
        )

    # Dart library packages deliberately do not commit their generated client
    # lock. Exclude a developer-local `dart pub get` result from the staged
    # source target while preserving the binding's reviewed lock below.
    copy_tree(
        ROOT / "clients/dart",
        output / "clients/dart",
        ignored_names=frozenset({"pubspec.lock"}),
    )
    copy_tree(ROOT / "syncer.c/core/include", output / "syncer.c/core/include")
    copy_tree(ROOT / "syncer.c/core/src", output / "syncer.c/core/src")
    copy_tree(ROOT / "syncer.c/core/test", output / "syncer.c/core/test")
    copy_file(ROOT / "syncer.c/core/CMakeLists.txt", output / "syncer.c/core/CMakeLists.txt")
    copy_tree(ROOT / "syncer.c/bindings/dart", output / "syncer.c/bindings/dart")
    copy_tree(ROOT / "syncer.c/bindings/wasm", output / "syncer.c/bindings/wasm")
    copy_tree(ROOT / "schema/fixtures", output / "schema/fixtures")
    copy_tree(
        ROOT / "schema/telemetry-fixtures",
        output / "schema/telemetry-fixtures",
    )
    copy_file(
        ROOT / "schema/opto-sync-telemetry.schema.json",
        output / "schema/opto-sync-telemetry.schema.json",
    )
    copy_file(
        ROOT / "schema/opto-sync-consistency.v1.schema.json",
        output / "schema/opto-sync-consistency.v1.schema.json",
    )
    copy_file(
        ROOT / "formal/consistency_vectors.v1.json",
        output / "formal/consistency_vectors.v1.json",
    )
    copy_file(ROOT / "LICENSE", output / "LICENSE")
    copy_file(
        ROOT / "scripts/check-dart-target.py",
        output / "scripts/check-dart-target.py",
    )

    # The repository-level Dart browser harness locates Playwright through the
    # TypeScript client. An isolated Dart artifact must not carry another SDK,
    # so make the test harness consume an explicitly installed test dependency.
    web_harness = output / "clients/dart/tool/web_e2e.mjs"
    harness_text = web_harness.read_text(encoding="utf-8")
    old_import = "await import('../../ts/node_modules/playwright/index.mjs')"
    if old_import not in harness_text:
        fail("Dart browser harness no longer has the reviewed Playwright import")
    web_harness.write_text(
        harness_text.replace(old_import, "await import('playwright')"),
        encoding="utf-8",
    )

    write(output / "syncer.c/SOURCE_SHA", nested_sha + "\n")
    client_pubspec = output / "clients/dart/pubspec.yaml"
    binding_pubspec = output / "syncer.c/bindings/dart/pubspec.yaml"
    binding_lock = output / "syncer.c/bindings/dart/pubspec.lock"
    release_set = {
        "schemaVersion": 1,
        "target": "dart",
        "package": "opto-sync/opto-sync-client-dart",
        "clientVersion": "1.1.0",
        "syncerVersion": "0.2.1",
        "clientSourceSha": client_sha,
        "syncerSourceSha": nested_sha,
        "clientPubspecSha256": sha256(client_pubspec),
        "bindingPubspecSha256": sha256(binding_pubspec),
        "bindingPubLockSha256": sha256(binding_lock),
        "coreResolution": "bundled-source",
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.4.0",
        "coexistenceRule": (
            "all installed opto-sync targets must resolve the same syncerSourceSha"
        ),
        "supportedPlatforms": [
            "linux",
            "macos",
            "windows",
            "browser",
            "flutter-mobile",
        ],
        "publicationEnabled": False,
    }
    write(
        output / "release-set.json",
        json.dumps(release_set, indent=2, sort_keys=True) + "\n",
    )
    write(
        output / ".zpkg.toml",
        '''[package]
org = "opto-sync"
name = "opto-sync-client-dart"
version = "1.1.0"
description = "Clean-room Dart and Flutter sync client with bundled native and WASM cores"
license = "MIT"

[package.repository]
vcs = "git"
url = "https://github.com/opto-sync/opto-sync-clients"

[publish]
include_readme = true
tag_format = "dart-v{version}"
smoke_test = 'python3 "$ZED_PKG_TEST_TARGET/scripts/check-dart-target.py" "$ZED_PKG_TEST_TARGET"'
exclude = [
  ".zed/**",
  "**/.dart_tool/**",
  "**/node_modules/**",
  "**/build/**",
  "**/target/**",
  "**/.tmp/**",
]

[scripts]
test = "python3 scripts/check-dart-target.py ."
''',
    )
    write(output / ".zpkg.lock", "version = 1\n")
    write(
        output / "README.md",
        f'''# opto-sync Dart/Flutter target candidate

This source target contains only the Dart client, the exact pinned C core,
the Dart FFI binding, and the browser WASM binding. It is intended for
Linux, macOS, Windows, real Chromium, and explicit Flutter-mobile compile
smokes from one packed artifact.

- client commit: `{client_sha}`
- syncer.c commit: `{nested_sha}`
- Dart binding lock SHA-256: `{release_set["bindingPubLockSha256"]}`

The Dart client is a library and deliberately does not commit a generated
`pubspec.lock`; the bundled binding's committed lock and both pubspec hashes
are recorded in `release-set.json`. CI must run `dart pub get` in the extracted
artifact and keep those recorded source identities unchanged. Browser tooling
is test-only and must be installed explicitly by the clean-room consumer.

Publication remains disabled until the exact archive passes every platform and
the coordinated release set is approved.
''',
    )

    subprocess.run(
        [sys.executable, str(output / "scripts/check-dart-target.py"), str(output)],
        check=True,
    )
    print(
        "staged Dart target: "
        f"client={client_sha[:12]} core={nested_sha[:12]} "
        f"binding-lock={release_set['bindingPubLockSha256'][:12]}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
