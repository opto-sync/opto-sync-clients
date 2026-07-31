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

# The BEAM harness predates the finalized external field name and uses
# `tracePaths` internally. Normalize the canonical fmctl `traces` request at the
# process boundary; do not alter the corpus, ordering, or replay implementation.
request_file=$(mktemp)
result_file=$(mktemp)
normalized_request_file=$(mktemp)
trap 'rm -f "$request_file" "$result_file" "$normalized_request_file"' EXIT HUP INT TERM
cat >"$request_file"
trace_count=$(jq -er '.traces | arrays | length | select(. > 0)' "$request_file")
jq -c '. + {tracePaths: .traces}' "$request_file" >"$normalized_request_file"
erl -noshell "$@" -s opto_sync_formal_replay_ffi main \
  <"$normalized_request_file" >"$result_file"

# Normalize the harness's detailed internal result into the repository-wide
# fmctl.adapter.v1 aggregate envelope used by Rust, TypeScript, and Dart.
jq -c --argjson trace_count "$trace_count" '
  if .result.status == "ok" then
    {
      protocol: .protocol,
      success: true,
      traces_total: .result.traceCount,
      traces_passed: .result.traceCount,
      mismatches: [],
      implementation: {
        language: "gleam",
        name: "opto_sync_client production protocol projection",
        version: "0.1.0"
      }
    }
  else
    {
      protocol: .protocol,
      success: false,
      traces_total: $trace_count,
      traces_passed: 0,
      mismatches: [{
        trace: (.result.tracePath // "<adapter-request>"),
        step: .result.stateIndex,
        action: .result.action,
        message: .result.error,
        expected: null,
        actual: null
      }],
      implementation: {
        language: "gleam",
        name: "opto_sync_client production protocol projection",
        version: "0.1.0"
      }
    }
  end
' "$result_file"
