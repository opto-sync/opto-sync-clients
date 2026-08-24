#!/usr/bin/env python3
"""Stage the self-contained Gleam/BEAM Zed target from a recursive checkout."""

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
    print(f"stage-gleam-target: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str, cwd: Path = ROOT) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(cwd), *args], text=True, stderr=subprocess.STDOUT
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"git {' '.join(args)} failed: {exc.output.strip()}")


def copy_tree(source: Path, destination: Path) -> None:
    if not source.is_dir():
        fail(f"required source directory is missing: {source.relative_to(ROOT)}")
    shutil.copytree(
        source,
        destination,
        ignore=lambda _directory, names: {name for name in names if name in IGNORED},
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
        fail("usage: stage-gleam-target.py OUTPUT_DIRECTORY")
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

    copy_tree(ROOT / "clients/gleam", output / "clients/gleam")
    copy_tree(ROOT / "syncer.c/core/include", output / "syncer.c/core/include")
    copy_tree(ROOT / "syncer.c/core/src", output / "syncer.c/core/src")
    for binding in ("rust", "beam", "gleam"):
        copy_tree(
            ROOT / f"syncer.c/bindings/{binding}",
            output / f"syncer.c/bindings/{binding}",
        )
    copy_tree(ROOT / "schema/fixtures", output / "schema/fixtures")
    copy_file(ROOT / "LICENSE", output / "LICENSE")
    copy_file(
        ROOT / "scripts/check-gleam-target.py",
        output / "scripts/check-gleam-target.py",
    )
    write(output / "syncer.c/SOURCE_SHA", nested_sha + "\n")
    write(
        output / "smoke/core_identity.exs",
        '''version = Syncer.version()
unless version == "0.2.1" do
  raise "expected bundled syncer.c 0.2.1, received #{inspect(version)}"
end
IO.puts("Gleam/BEAM blank consumer linked syncer.c #{version}")
''',
    )

    release_set = {
        "schemaVersion": 1,
        "target": "gleam",
        "package": "opto-sync/opto-sync-client-gleam",
        "clientVersion": "0.1.0",
        "syncerVersion": "0.2.1",
        "clientSourceSha": client_sha,
        "syncerSourceSha": nested_sha,
        "gleamManifestSha256": sha256(output / "clients/gleam/manifest.toml"),
        "bindingManifestSha256": sha256(
            output / "syncer.c/bindings/gleam/manifest.toml"
        ),
        "mixLockSha256": sha256(output / "syncer.c/bindings/beam/mix.lock"),
        "nifCargoLockSha256": sha256(
            output / "syncer.c/bindings/beam/native/syncer_nif/Cargo.lock"
        ),
        "coreResolution": "bundled-source",
        "wholeRepositoryPackage": "opto-sync/opto-sync-clients@0.4.0",
        "coexistenceRule": (
            "all installed opto-sync targets must resolve the same syncerSourceSha"
        ),
        "supportedPlatforms": ["linux", "macos"],
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
name = "opto-sync-client-gleam"
version = "0.1.0"
description = "Clean-room Gleam/BEAM client with the exact bundled syncer.c NIF"
license = "MIT"

[package.repository]
vcs = "git"
url = "https://github.com/opto-sync/opto-sync-clients"

[publish]
include_readme = true
tag_format = "gleam-v{version}"
smoke_test = 'python3 "$ZED_PKG_TEST_TARGET/scripts/check-gleam-target.py" "$ZED_PKG_TEST_TARGET"'
exclude = [
  ".zed/**",
  "**/deps/**",
  "**/_build/**",
  "**/build/**",
  "**/target/**",
  "**/.tmp/**",
]

[scripts]
test = "python3 scripts/check-gleam-target.py ."
''',
    )
    write(output / ".zpkg.lock", "version = 1\n")
    write(
        output / "README.md",
        f'''# opto-sync Gleam/BEAM target candidate

This source target contains the Gleam client, exact Gleam binding, BEAM/Rustler
NIF, Rust FFI binding, and pinned C core needed to build in a blank Linux or
macOS consumer.

- client commit: `{client_sha}`
- syncer.c commit: `{nested_sha}`
- client manifest SHA-256: `{release_set["gleamManifestSha256"]}`
- Mix lock SHA-256: `{release_set["mixLockSha256"]}`
- NIF Cargo lock SHA-256: `{release_set["nifCargoLockSha256"]}`

The `opto_sync_nif_not_loaded` error remains an explicit tagged diagnostic and
names the `OPTO_SYNC_BEAM_EBIN` recovery path. CI must build the NIF, require
`Syncer.version()` to report `0.2.1`, run the Gleam suite from the extracted
artifact, and preserve every recorded lock digest.

Publication remains disabled until both clean-room operating-system jobs pass
and the coordinated release set is approved.
''',
    )

    subprocess.run(
        [sys.executable, str(output / "scripts/check-gleam-target.py"), str(output)],
        check=True,
    )
    print(
        "staged Gleam target: "
        f"client={client_sha[:12]} core={nested_sha[:12]} "
        f"mix-lock={release_set['mixLockSha256'][:12]}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
