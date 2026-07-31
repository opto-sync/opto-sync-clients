#!/usr/bin/env sh
set -eu

# fmctl runs this adapter with clients/gleam as its working directory, while a
# developer may invoke the script from elsewhere. Resolve the package directory
# from the script itself so both entry paths execute the same pre-built code.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(dirname -- "$script_dir")
cd "$package_dir"

# Gleam writes generated Erlang applications below build/, while the production
# Elixir/Rustler NIF is built below the sibling Mix _build/ tree. Gleam package
# modules and Erlang dependencies may live in `_gleam_artefacts` rather than an
# OTP `ebin` directory, so both compiled forms belong on the VM path. This
# launcher never compiles and keeps stdout reserved for the JSON-lines protocol.
search_roots=""
for root in build _build ../../syncer.c/bindings/beam/_build; do
  if [ -d "$root" ]; then
    search_roots="$search_roots $root"
  fi
done

if [ -z "$search_roots" ]; then
  printf '%s\n' 'BEAM build artifacts are missing; run the Gleam and NIF builds first.' >&2
  exit 70
fi

# Paths in this repository contain no newlines. Sorting ensures stable VM code
# path order across runners and local invocations.
beam_path_list=$(
  find $search_roots -type d \( -name ebin -o -name _gleam_artefacts \) -print \
    | LC_ALL=C sort -u
)
if [ -z "$beam_path_list" ]; then
  printf '%s\n' 'The completed builds produced no compiled BEAM directories.' >&2
  exit 70
fi

set --
old_ifs=$IFS
IFS='
'
for directory in $beam_path_list; do
  set -- "$@" -pa "$directory"
done
IFS=$old_ifs

exec erl -noshell "$@" -s opto_sync_formal_replay_ffi main
