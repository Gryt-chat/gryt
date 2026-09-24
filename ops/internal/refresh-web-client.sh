#!/usr/bin/env bash
# Keep the hosted stacks on the image the last release published. Nothing ever
# pulled it, so app.gryt.chat served 1.5.6 against a 1.6.15 app (GRYT-291).

# Gryt's own defaults, then the shared script self-hosters install from
# ops/deploy/auto-update (GRYT-1456) — one implementation, nothing to change here.

set -euo pipefail

: "${GRYT_STACKS:=prod beta test demo}"
: "${GRYT_SERVICES:=${GRYT_SERVICE:-sfu server server-nt server-pp image-worker image-worker-nt image-worker-pp client}}"
: "${GRYT_CONTAINERS:=gryt-reports}"
: "${GRYT_PROFILES:=web}"
export GRYT_STACKS GRYT_SERVICES GRYT_CONTAINERS GRYT_PROFILES

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec "$here/../deploy/auto-update/gryt-auto-update.sh"
