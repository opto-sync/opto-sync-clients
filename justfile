set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := false

default:
    @just --list --unsorted

bootstrap:
    @ores-sops install-hooks
    @ores-sops verify

seed name:
    #!/usr/bin/env bash
    set -euo pipefail
    case '{{ name }}' in dev|prod) ;; *) echo "profile must be dev or prod" >&2; exit 2 ;; esac
    ores-sops ensure-dec
    target="env/dec/{{ name }}.env"
    test ! -e "$target" || { echo "refusing to overwrite $target" >&2; exit 1; }
    umask 077
    cp .env.example "$target"
    chmod 600 "$target"

exec-env name +command:
    @ores-sops ensure-dec
    @sops exec-env --input-type dotenv env/enc/{{ name }}.env.enc '{{ command }}'

use name:
    @ores-sops ensure-dec
    @ores-sops use {{ name }}

status:
    @ores-sops status

edit name:
    @ores-sops edit {{ name }}

encrypt name:
    @ores-sops ensure-dec
    @ores-sops encrypt {{ name }}

diff name:
    @ores-sops diff {{ name }}

refresh:
    @ores-sops ensure-dec
    @ores-sops refresh

lock:
    @ores-sops lock

verify:
    @bash scripts/check-env-policy.sh
    @ores-sops verify

verify-release-policy name="prod":
    @python3 scripts/verify-sops-release-policy.py .sops.yaml {{ name }}
