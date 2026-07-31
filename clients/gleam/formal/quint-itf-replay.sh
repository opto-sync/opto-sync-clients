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
# launcher never compiles and keeps stdout reserved for the JSON protocol.
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

# fmctl.adapter.v1 is a batch contract. The repository-local BEAM harness has a
# deliberately smaller isolation boundary: one fresh adapter process per trace.
# Fan out the canonical batch into one-trace sessions, validate that each harness
# actually reports exactly one replayed trace, and aggregate the canonical fmctl
# response. This preserves batch correlation while preventing state leakage
# between traces; it does not paper over an incorrect harness count.
request_file=$(mktemp)
trace_list_file=$(mktemp)
single_request_file=$(mktemp)
single_result_file=$(mktemp)
normalized_trace_file=$(mktemp)
first_failure_file=$(mktemp)
trap 'rm -f "$request_file" "$trace_list_file" "$single_request_file" "$single_result_file" "$normalized_trace_file" "$first_failure_file"' EXIT HUP INT TERM
cat >"$request_file"

trace_count=$(jq -er '.traces | arrays | length | select(. > 0)' "$request_file")
jq -er '.traces[] | strings | select(length > 0)' "$request_file" >"$trace_list_file"
listed_trace_count=$(wc -l <"$trace_list_file" | tr -d ' ')
if [ "$listed_trace_count" -ne "$trace_count" ]; then
  printf '%s\n' 'fmctl adapter request contains a non-string, empty, or newline-bearing trace path.' >&2
  exit 65
fi

traces_passed=0
failed_trace=''
: >"$first_failure_file"

while IFS= read -r trace_path; do
  # The current model calls the non-replacing phase `Idle` and derives allocated
  # mutation IDs from next_id. The older BEAM observer calls that phase `Ready`
  # and expects the derived set explicitly. Normalize only those observation
  # aliases in a temporary copy; actions and all state values remain unchanged.
  jq '
    .states |= map(
      .s.ids = {
        "#set": [
          range(1; (.s.next_id["#bigint"] | tonumber))
          | {"#bigint": tostring}
        ]
      }
      | if .s.reset_phase.tag == "Idle" then
          .s.reset_phase.tag = "Ready"
        else
          .
        end
    )
  ' "$trace_path" >"$normalized_trace_file"

  jq -c --arg trace_path "$normalized_trace_file" '
    . + {
      traces: [$trace_path],
      tracePaths: [$trace_path]
    }
  ' "$request_file" >"$single_request_file"

  erl -noshell "$@" -s opto_sync_formal_replay_ffi main \
    <"$single_request_file" >"$single_result_file"

  internal_status=$(jq -er '.result.status | strings' "$single_result_file")
  internal_trace_count=$(jq -er '.result.traceCount // 0' "$single_result_file")

  if [ "$internal_status" = 'ok' ] && [ "$internal_trace_count" -eq 1 ]; then
    traces_passed=$((traces_passed + 1))
    continue
  fi

  failed_trace=$trace_path
  cp "$single_result_file" "$first_failure_file"
  break
done <"$trace_list_file"

if [ "$traces_passed" -eq "$trace_count" ]; then
  jq -nc \
    --arg protocol 'fmctl.adapter.v1' \
    --argjson trace_count "$trace_count" '
    {
      protocol: $protocol,
      success: true,
      traces_total: $trace_count,
      traces_passed: $trace_count,
      mismatches: [],
      implementation: {
        language: "gleam",
        name: "opto_sync_client production protocol projection",
        version: "0.1.0"
      }
    }
  '
  exit 0
fi

if [ ! -s "$first_failure_file" ]; then
  jq -nc \
    --arg protocol 'fmctl.adapter.v1' \
    --argjson trace_count "$trace_count" \
    --argjson traces_passed "$traces_passed" \
    --arg trace "$failed_trace" '
    {
      protocol: $protocol,
      success: false,
      traces_total: $trace_count,
      traces_passed: $traces_passed,
      mismatches: [{
        trace: $trace,
        step: null,
        action: null,
        message: "Gleam adapter batch ended without a valid one-trace result",
        expected: null,
        actual: null
      }],
      implementation: {
        language: "gleam",
        name: "opto_sync_client production protocol projection",
        version: "0.1.0"
      }
    }
  '
  exit 0
fi

jq -c \
  --argjson trace_count "$trace_count" \
  --argjson traces_passed "$traces_passed" \
  --arg failed_trace "$failed_trace" '
  {
    protocol: (.protocol // "fmctl.adapter.v1"),
    success: false,
    traces_total: $trace_count,
    traces_passed: $traces_passed,
    mismatches: [{
      trace: $failed_trace,
      step: .result.stateIndex,
      action: .result.action,
      message: (
        if .result.status == "ok" then
          "Gleam adapter reported an invalid per-trace aggregate count"
        else
          (.result.error // "Gleam adapter replay failed")
        end
      ),
      expected: { traceCount: 1 },
      actual: { traceCount: (.result.traceCount // null) }
    }],
    implementation: {
      language: "gleam",
      name: "opto_sync_client production protocol projection",
      version: "0.1.0"
    }
  }
' "$first_failure_file"
