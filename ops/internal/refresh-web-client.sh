#!/usr/bin/env bash
#
# Keep the hosted web clients on the image the last release published.
#
# app.gryt.chat and beta.gryt.chat are nginx containers serving a build that
# `Release Client` already pushed to GHCR. Nothing ever pulled it. On 2026-08-17
# app.gryt.chat was serving 1.5.6 while the desktop app was on 1.6.15-beta.1, so
# every identity feature from 1.6.0 — the derived seed, the 24-word backup,
# keychain sealing — looked like it was desktop-only when it had simply never
# been deployed (GRYT-291).
#
# Run from the systemd timer beside this script. Safe to run by hand.
#
# Deliberately narrow. It refreshes one service on each stack and recreates the
# container only when the image actually moved. It does not touch the server,
# the SFU, the image worker, MinIO or anything else on the box — those carry
# data, and a roll-forward on them is a decision rather than a cron job.
#
# It also only ever refreshes a container that is already there. It will not
# bring a missing one up, because it does not know what that stack was supposed
# to look like and guessing would be worse than saying so.
#
# Environment:
#   GRYT_STACKS        stacks to refresh, space separated. Default "prod beta".
#                      Each name <s> refreshes the container gryt-<s>-client.
#   GRYT_SERVICE       compose service to refresh. Default "client".
#   GRYT_MIN_FREE_GB   refuse to pull below this much free disk. Default 10.

set -euo pipefail

STACKS="${GRYT_STACKS:-prod beta}"
SERVICE="${GRYT_SERVICE:-client}"
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null || true
}

refresh() {
  local stack="$1"
  local container="gryt-${stack}-${SERVICE}"
  local -a args=()
  local config_files env_file working_dir f before after free_gb

  # Read the stack's shape off the container rather than guessing at it.
  #
  # The overlay files and their order are not incidental: compose merges them
  # left to right, so a different list is a different merged config, and `up`
  # would then recreate the container to match something nobody asked for —
  # every ten minutes, forever. Some of the overlays are untracked and exist
  # only on the machine running this, so there is no list in the repo that
  # could be right anyway. The labels are what the stack was actually brought
  # up with, which is the only answer that cannot drift.
  config_files=$(label "$container" "project.config_files")
  if [[ -z "$config_files" ]]; then
    log "[$stack] no container named $container — skipped"
    return 0
  fi

  working_dir=$(label "$container" "project.working_dir")
  env_file=$(label "$container" "project.environment_file")

  [[ -n "$env_file" ]] && args+=(--env-file "$env_file")

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ ! -f "$f" ]]; then
      log "[$stack] $f is gone since the stack came up — skipped"
      return 1
    fi
    args+=(-f "$f")
  done < <(tr ',' '\n' <<<"$config_files")

  # The auth database sits on the same disk as everything else, so a pull that
  # fills it takes Keycloak down with it. Cheap to check, and the failure it
  # prevents is not cheap at all.
  free_gb=$(df -BG --output=avail "${working_dir:-/}" | tail -1 | tr -dc '0-9')
  if (( free_gb < MIN_FREE_GB )); then
    log "[$stack] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to pull"
    return 1
  fi

  before=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)

  # `--progress quiet` on both calls, because this runs every ten minutes and
  # journald does not need three lines of "Pulling / Pulled / Running" each time
  # to say nothing happened. Errors still come through.
  #
  # `--profile web` because the client service sits behind that profile in the
  # compose files; naming a service in a profile that is not enabled is a no-op
  # rather than an error, which would be a silent one.
  if ! docker compose --progress quiet "${args[@]}" --profile web pull --quiet "$SERVICE"; then
    log "[$stack] pull failed — leaving the running container alone"
    return 1
  fi

  # `--no-deps` because the client's `depends_on` reaches the server, and the
  # server owns the sqlite database. Nothing about a new web bundle is a reason
  # to go anywhere near it. A bare `up -d` here would take the whole stack.
  #
  # This is a no-op when the pull brought nothing new: compose only recreates a
  # container whose image id has moved.
  if ! docker compose --progress quiet "${args[@]}" --profile web up -d --no-deps "$SERVICE"; then
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
for stack in $STACKS; do
  refresh "$stack" || status=1
done

# Nothing is removed here on purpose. Each superseded client image is left
# dangling, which is about 30MB a release, and no rule on this box lets a script
# delete images — the disk it would be freeing is the one the auth database sits
# on. Reclaiming it stays a decision somebody makes while looking at
# `docker image ls`.

exit "$status"
