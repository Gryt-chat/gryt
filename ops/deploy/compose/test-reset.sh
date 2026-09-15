#!/usr/bin/env bash
# Resets the gryt-test stack and nothing else. See TEST.md.
# Usage: test-reset.sh [--empty | --save-seed]

set -euo pipefail

PROJECT=gryt-test
HERE=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
FILE="$HERE/test.yml"
ENV_FILE="${GRYT_TEST_COMPOSE_ENV:-$HERE/.env.test}"
CONTAINERS=(gryt-test-image-worker gryt-test-server gryt-test-sfu gryt-test-server-data-init)
DATA_VOLUME=gryt-test-server-data
SEED_VOLUME=gryt-test-seed
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

log() { printf '%s  %s\n' "$(date '+%FT%T%z')" "$*"; }
die() { log "$*"; exit 1; }

mode="${1:-}"
case "$mode" in
  "" | --empty | --save-seed) ;;
  *) die "usage: $0 [--empty | --save-seed]" ;;
esac
(( $# <= 1 )) || die "usage: $0 [--empty | --save-seed]"

if [[ -n "${COMPOSE_PROJECT_NAME:-}" && "$COMPOSE_PROJECT_NAME" != "$PROJECT" ]]; then
  die "COMPOSE_PROJECT_NAME is $COMPOSE_PROJECT_NAME, and this script only resets $PROJECT"
fi
[[ -f "$FILE" ]] || die "$FILE is missing"
grep -qx "name: $PROJECT" "$FILE" || die "$FILE is not the $PROJECT stack"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing, and the server won't start without JWT_SECRET"

compose() { docker compose -p "$PROJECT" -f "$FILE" --env-file "$ENV_FILE" "$@"; }

container_project() {
  docker container inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$1"
}

volume_label() {
  docker volume inspect --format "{{index .Labels \"$2\"}}" "$1"
}

# Checked before anything stops, so a refusal never leaves the stack half torn down.
existing=()
for c in "${CONTAINERS[@]}"; do
  docker container inspect "$c" >/dev/null 2>&1 || continue
  [[ "$(container_project "$c")" == "$PROJECT" ]] || die "$c is not part of $PROJECT, refusing"
  existing+=("$c")
done

if docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  [[ "$(volume_label "$DATA_VOLUME" com.docker.compose.project)" == "$PROJECT" ]] \
    || die "$DATA_VOLUME was not made by $PROJECT, refusing"
fi

if docker volume inspect "$SEED_VOLUME" >/dev/null 2>&1; then
  [[ "$(volume_label "$SEED_VOLUME" chat.gryt.stack)" == "$PROJECT" ]] \
    || die "$SEED_VOLUME was not made by this script, refusing"
fi

wait_healthy() {
  local c deadline=$((SECONDS + 300))
  for c in gryt-test-sfu gryt-test-server gryt-test-image-worker; do
    until [[ "$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null)" == healthy ]]; do
      (( SECONDS < deadline )) || die "$c is not healthy after five minutes"
      sleep 5
    done
  done
  log "$PROJECT is up and healthy"
}

if [[ "$mode" == --save-seed ]]; then
  docker container inspect gryt-test-server >/dev/null 2>&1 || die "$PROJECT is not running, so there is nothing to save"
  docker volume inspect "$SEED_VOLUME" >/dev/null 2>&1 \
    || docker volume create --label "chat.gryt.stack=$PROJECT" "$SEED_VOLUME" >/dev/null

  # Stopped so the database and its WAL are copied as one consistent set.
  docker stop gryt-test-image-worker gryt-test-server >/dev/null
  copied=0
  docker run --rm -v "$DATA_VOLUME:/data:ro" -v "$SEED_VOLUME:/seed" alpine:3 \
    sh -c 'find /seed -mindepth 1 -delete && cp -a /data/. /seed/' || copied=$?
  compose up -d
  (( copied == 0 )) || die "copying $DATA_VOLUME into $SEED_VOLUME failed, and the stack is back up as it was"
  wait_healthy
  log "saved $DATA_VOLUME as the seed, so later resets start from this state"
  exit 0
fi

free_gb=$(df -Pk "$HERE" | awk 'NR == 2 { print int($4 / 1048576) }')
(( free_gb >= MIN_FREE_GB )) || die "only ${free_gb}G free, want ${MIN_FREE_GB}G, so not pulling"
compose pull --quiet

if (( ${#existing[@]} > 0 )); then
  docker stop "${existing[@]}" >/dev/null
  docker rm "${existing[@]}" >/dev/null
  log "removed ${existing[*]}"
fi

if docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  if ! docker volume rm "$DATA_VOLUME" >/dev/null; then
    compose up -d
    die "could not remove $DATA_VOLUME, so the stack is back up on its old data"
  fi
  log "removed $DATA_VOLUME"
fi

compose create
if [[ "$mode" == --empty ]]; then
  log "starting empty: nobody owns the server and there are no invites"
elif docker volume inspect "$SEED_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$SEED_VOLUME:/seed:ro" -v "$DATA_VOLUME:/data" alpine:3 cp -a /seed/. /data/ \
    || die "restoring $SEED_VOLUME failed, so the stack is left stopped. Run this again, or with --empty"
  log "restored $DATA_VOLUME from $SEED_VOLUME"
else
  log "no seed saved yet: nobody owns the server and there are no invites"
fi

compose up -d
wait_healthy
