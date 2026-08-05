#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
find "$here/src/main/java" "$here/src/test/java" -name '*.java' -print0 \
  | xargs -0 javac --release 17 -Xlint:all -Werror -d "$out"
java -ea -cp "$out" dev.optosync.validation.EnvelopeValidationTest \
  "$root/schema/fixtures"
