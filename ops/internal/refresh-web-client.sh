#!/usr/bin/env bash
#
# Keep app.gryt.chat and beta.gryt.chat on the image the last release published.
#
# Both are nginx containers serving a build that `Release Client` already pushed
# to GHCR. Nothing ever pulled it. On 2026-08-17 app.gryt.chat was serving 1.5.6
# while the desktop app was on 1.6.15-beta.1, so every identity feature from
# 1.6.0 — the derived seed, the 24-word backup, keychain sealing — looked like it
# was desktop-only when it had simply never been deployed (GRYT-291).
#
# Run from the systemd timer beside this script. Safe to run by hand.
#
# Deliberately narrow. It pulls one service on two stacks and recreates it only
# when the image actually moved. It does not touch the server, the SFU, the
# image worker, MinIO or anything else on this box — those carry data, and a
# roll-forward on them is a decision rather than a cron job.

set -euo pipefail

COMPOSE_DIR="${GRYT_COMPOSE_DIR:-/home/sivert/gryt/ops/deploy/compose}"
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

# The auth database lives on the same disk as everything else here, so a pull
# that fills it takes Keycloak down with it. Cheap to check, and the failure it
# prevents is not cheap at all.
free_gb=$(df -BG --output=avail "$COMPOSE_DIR" | tail -1 | tr -dc '0-9')
if (( free_gb < MIN_FREE_GB )); then
  log "FATAL only ${free_gb}G free on $COMPOSE_DIR, want ${MIN_FREE_GB}G — refusing to pull"
  exit 1
fi

# Which overlay files each stack was brought up with, in order. Order matters:
# compose merges left to right, so a different order is a different config, and
# `up` would then recreate the container to match something nobody asked for.
#
# The `.local` and `pp` overlays are untracked and live only on this box. A
# missing one is normal and is skipped rather than being an error.
stack_files() {
  case "$1" in
    prod) printf '%s\n' prod.yml prod.local.yml pp.yml ;;
    beta) printf '%s\n' beta.yml beta.local.yml ;;
    *)    log "FATAL unknown stack '$1'"; exit 1 ;;
  esac
}

refresh() {
  local stack="$1"
  local container="gryt-${stack}-client"
  local env_file="$COMPOSE_DIR/.env.${stack}"
  local -a args=()
  local f

  if [[ ! -f "$env_file" ]]; then
    log "[$stack] no $env_file — skipped"
    return 0
  fi
  args+=(--env-file "$env_file")

  while IFS= read -r f; do
    [[ -f "$COMPOSE_DIR/$f" ]] && args+=(-f "$COMPOSE_DIR/$f")
  done < <(stack_files "$stack")

  # The base file is the one that names the project and defines the service.
  # Without it the rest describe nothing, and compose would happily invent a
  # project from the directory name.
  if [[ " ${args[*]} " != *" $COMPOSE_DIR/${stack}.yml "* ]]; then
    log "[$stack] no ${stack}.yml in $COMPOSE_DIR — skipped"
    return 0
  fi

  local before after
  before=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)

  # `--progress quiet` on both calls, because this runs every ten minutes and
  # journald does not need three lines of "Pulling / Pulled / Running" each
  # time to say nothing happened. Errors still come through.
  if ! docker compose --progress quiet "${args[@]}" --profile web pull --quiet client; then
    log "[$stack] pull failed — leaving the running container alone"
    return 1
  fi

  # `--no-deps` because the client's `depends_on` reaches the server, and the
  # server owns the sqlite database. Nothing about a new web bundle is a reason
  # to go anywhere near it. A bare `up -d` here would take the whole stack.
  #
  # This is a no-op when the pull brought nothing new: compose only recreates a
  # container whose image id has moved.
  if ! docker compose --progress quiet "${args[@]}" --profile web up -d --no-deps client; then
    log "[$stack] up failed"
    return 1
  fi

  after=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)

  if [[ "$before" == "$after" ]]; then
    log "[$stack] already current (${after:0:19})"
  else
    log "[$stack] ${before:0:19} -> ${after:0:19}"
  fi
}

status=0
for stack in prod beta; do
  refresh "$stack" || status=1
done

# Nothing is removed here on purpose. Each superseded client image is left
# dangling, which is about 30MB a release, and this box has no rule that lets a
# script delete images — the disk it would be freeing is the one the auth
# database sits on. Reclaiming it stays a decision somebody makes while looking
# at `docker image ls`.

exit "$status"
