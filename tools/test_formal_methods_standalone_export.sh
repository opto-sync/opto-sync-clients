#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

python3 -m py_compile tools/export_formal_methods_standalone.py
python3 tools/export_formal_methods_standalone.py --check >/tmp/formal-methods-export-check.json

first="$(mktemp -d)"
second="$(mktemp -d)"
trap 'rm -rf "$first" "$second"' EXIT

python3 tools/export_formal_methods_standalone.py --destination "$first" >/tmp/formal-methods-export-first.json
python3 tools/export_formal_methods_standalone.py --destination "$second" >/tmp/formal-methods-export-second.json

diff -ru "$first" "$second"
cmp "$first/SOURCE_EXPORT.json" "$second/SOURCE_EXPORT.json"

for forbidden in clients adoption syncer.c; do
  if [[ -e "$first/$forbidden" ]]; then
    echo "forbidden product path leaked into standalone export: $forbidden" >&2
    exit 1
  fi
done

if find "$first" -type l -print -quit | grep -q .; then
  echo "standalone export contains a symlink" >&2
  exit 1
fi

python3 - "$first/SOURCE_EXPORT.json" <<'PY'
import hashlib
import json
import pathlib
import sys

provenance_path = pathlib.Path(sys.argv[1])
root = provenance_path.parent
provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
files = provenance["files"]
assert files == sorted(files, key=lambda entry: entry["path"])
assert files, "export provenance must contain files"
for entry in files:
    path = root / entry["path"]
    data = path.read_bytes()
    assert len(data) == entry["size"], entry["path"]
    assert hashlib.sha256(data).hexdigest() == entry["sha256"], entry["path"]
print(f"verified {len(files)} byte-identical exported files")
PY

cargo check --locked --manifest-path "$first/tools/fmctl/Cargo.toml"
