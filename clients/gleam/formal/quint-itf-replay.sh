#!/usr/bin/env sh
set -eu

# `gleam build` runs before this launcher. Add every package ebin directory to
# the VM path without invoking the compiler here, so stdout remains one JSON
# protocol response and human/tool logs cannot contaminate framing.
set --
for directory in _build/dev/erlang/*/ebin _build/default/erlang/*/ebin; do
  if [ -d "$directory" ]; then
    set -- "$@" -pa "$directory"
  fi
done

if [ "$#" -eq 0 ]; then
  printf '%s\n' 'Gleam build artifacts are missing; run gleam build first.' >&2
  exit 70
fi

exec erl -noshell "$@" -s opto_sync_formal_replay_ffi main
