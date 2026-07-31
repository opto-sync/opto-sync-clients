#!/usr/bin/env sh
set -eu

# fmctl launches adapters from the repository root, while developers may invoke
# this script from the Gleam package. Resolve the package directory from the
# script itself so both entry paths execute the exact same pre-built BEAM code.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(dirname -- "$script_dir")
cd "$package_dir"

# `gleam build` runs before this launcher. Gleam has used more than one nested
# Erlang output layout across releases, so discover every compiled ebin directory
# deterministically instead of encoding one historical path. The launcher still
# performs no compilation and writes no human output to stdout.
if [ ! -d _build ]; then
  printf '%s\n' 'Gleam build artifacts are missing; run gleam build first.' >&2
  exit 70
fi

ebin_list=$(find _build -type d -name ebin -print | LC_ALL=C sort)
if [ -z "$ebin_list" ]; then
  printf '%s\n' 'Gleam build produced no BEAM ebin directories.' >&2
  exit 70
fi

set --
old_ifs=$IFS
IFS='
'
for directory in $ebin_list; do
  set -- "$@" -pa "$directory"
done
IFS=$old_ifs

exec erl -noshell "$@" -s opto_sync_formal_replay_ffi main
