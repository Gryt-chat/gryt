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
# It refreshes a list of services on each stack and recreates a container only
# when its image actually moved.
#
# This used to stop at the web client, on the argument that rolling the server
# and the SFU forward is a decision rather than a cron job. That was reversed on
# 2026-08-21: leaving them behind is also a decision, and it is the one that
# produced GRYT-291 in the first place. The trade is now the other way round and
# worth stating plainly.
#
# It waits rather than interrupting. Recreating the SFU drops every call in
# progress, so the SFU is only recreated when nobody is in voice on that stack:
# the SFU publishes gryt_sfu_peers_active on /metrics, and a run that finds
# anybody connected leaves it alone and tries again on the next tick. On a ten
# minute timer that lands the update the first time the channel empties, which
# is usually the same evening and never mid-conversation.
#
# The servers need no such gate. Signalling and media are separate connections,
# so restarting a server does not touch a call in progress — clients reconnect
# on their own through session:restore and the audio never stops. That is the
# whole reason the split exists, and it is what makes this quiet.
#
# So there is nothing to announce. A "restarting in five minutes" notice would
# be warning people about something they are not going to notice.
#
# Not everything worth refreshing is called `gryt-<stack>-<service>`. The report
# inbox is one container in the `internal` project, so it is named outright in
# GRYT_CONTAINERS rather than pretending to be a stack. Everything downstream of
# the name is identical — the same labels, the same pull, the same recreate.
#
# What still holds. MinIO, the one-shot init containers and anything under the
# `auth` project are never touched: MinIO and the init containers because they
# are not in the service list, and auth because it is a different compose
# project entirely and nothing here ever names it.
#
# It also only ever refreshes a container that is already there. It will not
# bring a missing one up, because it does not know what that stack was supposed
# to look like and guessing would be worse than saying so.
#
# Environment:
#   GRYT_STACKS        stacks to refresh, space separated. Default "prod beta".
#   GRYT_SERVICES      compose services to refresh on each stack, space
#                      separated. Each pair <stack>/<service> addresses the
#                      container gryt-<stack>-<service>, and one that does not
#                      exist is skipped rather than created — beta has no `-pp`
#                      services, so the same list works for both.
#                      GRYT_SERVICE (singular) still works.
#   GRYT_CONTAINERS    containers to refresh by name, space separated, for
#                      anything outside the stack naming. Default "gryt-reports".
#                      The compose service is read off the container's own
#                      label, so only the name goes here.
#   GRYT_MIN_FREE_GB   refuse to pull below this much free disk. Default 10.

set -euo pipefail

STACKS="${GRYT_STACKS:-prod beta}"
# The default list is every service that carries a released image. Ordered so
# the media plane and the servers land before the client that talks to them,
# which matters only in that a client refreshed first would spend a few seconds
# talking to a server about to restart.
DEFAULT_SERVICES="sfu server server-nt server-pp image-worker image-worker-nt image-worker-pp client"
SERVICES="${GRYT_SERVICES:-${GRYT_SERVICE:-$DEFAULT_SERVICES}}"
# Containers that carry a released image and are not part of a stack. The report
# inbox is the first: ghcr.io/gryt-chat/reports, one container in the `internal`
# project, and nothing pulled it until this line existed.
CONTAINERS="${GRYT_CONTAINERS:-gryt-reports}"
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null || true
}

# How many people are in voice on this stack, or empty if it cannot be
# determined.
#
# Read off the SFU's own Prometheus gauge through whichever host port that
# stack publishes 5005 on, so it works for prod and beta without either being
# named here.
sfu_peers() {
  local container="$1" hostport
  hostport=$(docker port "$container" 5005/tcp 2>/dev/null | head -1) || return 0
  [[ -z "$hostport" ]] && return 0
  # docker reports the wildcard bind; ask the loopback address instead.
  hostport=${hostport/0.0.0.0/127.0.0.1}
  hostport=${hostport/\[::\]/127.0.0.1}
  curl -sf --max-time 5 "http://${hostport}/metrics" 2>/dev/null \
    | awk '/^gryt_sfu_peers_active /{print $2; found=1} END{if(!found) exit 1}'
}

# The stack form: gryt-<stack>-<service>, refreshed with the `web` profile
# enabled because the client service sits behind it.
refresh() {
  refresh_container "gryt-${1}-${2}" "$2" "${1}/${2}" --profile web
}

# The general form. Everything the script needs comes off the container itself,
# so a container that is not part of a stack needs no more configuration than
# its name.
refresh_named() {
  local container="$1" service
  service=$(label "$container" "service")
  if [[ -z "$service" ]]; then
    log "[$container] no container by that name — skipped"
    return 0
  fi
  refresh_container "$container" "$service" "$container"
}

refresh_container() {
  local container="$1"
  local service="$2"
  local tag="$3"
  shift 3
  local -a profile=("$@")
  local -a args=()
  local config_files env_file working_dir f free_gb
  local image_before image_after id_before id_after

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
    log "[$tag] no container named $container — skipped"
    return 0
  fi

  working_dir=$(label "$container" "project.working_dir")
  env_file=$(label "$container" "project.environment_file")

  [[ -n "$env_file" ]] && args+=(--env-file "$env_file")

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ ! -f "$f" ]]; then
      log "[$tag] $f is gone since the stack came up — skipped"
      return 1
    fi
    args+=(-f "$f")
  done < <(tr ',' '\n' <<<"$config_files")

  # The auth database sits on the same disk as everything else, so a pull that
  # fills it takes Keycloak down with it. Cheap to check, and the failure it
  # prevents is not cheap at all.
  free_gb=$(df -BG --output=avail "${working_dir:-/}" | tail -1 | tr -dc '0-9')
  if (( free_gb < MIN_FREE_GB )); then
    log "[$tag] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to pull"
    return 1
  fi

  # Both, because they answer different questions. The image id says whether a
  # new release arrived; the container id says whether compose replaced the
  # container at all, which it also does when the service definition changes
  # underneath it. Watching only the image made a recreate report "already
  # current" — true of the image and wrong about what had just happened.
  image_before=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)
  id_before=$(docker inspect --format '{{.Id}}' "$container" 2>/dev/null || echo none)

  # `--progress quiet` on both calls, because this runs every ten minutes and
  # journald does not need three lines of "Pulling / Pulled / Running" each time
  # to say nothing happened. Errors still come through.
  #
  # `--profile web` because the client service sits behind that profile in the
  # compose files; naming a service in a profile that is not enabled is a no-op
  # rather than an error, which would be a silent one.
  if ! docker compose --progress quiet "${args[@]}" "${profile[@]}" pull --quiet "$service"; then
    log "[$tag] pull failed — leaving the running container alone"
    return 1
  fi

  # Would `up` actually replace this container? Compare what the running one is
  # on against what the pull just left behind under the same reference. Asked
  # before the gate below, because there is no point making anybody wait for a
  # recreate that was not going to happen.
  local image_ref pulled_id
  image_ref=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || echo "")
  pulled_id=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null || echo "")

  # The SFU is the one service whose recreate is felt, because it carries the
  # media. Wait for the channel to be empty rather than cutting anybody off; the
  # next tick is ten minutes away and the release is not urgent.
  #
  # An unreadable peer count defers too. Being unable to tell is not the same as
  # nobody being there, and the cost of guessing wrong is somebody's call.
  if [[ "$service" == "sfu" && -n "$pulled_id" && "$pulled_id" != "$image_before" ]]; then
    local peers
    peers=$(sfu_peers "$container") || peers=""
    if [[ -z "$peers" ]]; then
      log "[$tag] new image, but the peer count could not be read — deferring"
      return 0
    fi
    if [[ "${peers%%.*}" -gt 0 ]]; then
      log "[$tag] new image, but ${peers%%.*} in voice — deferring"
      return 0
    fi
    log "[$tag] new image and nobody in voice — recreating"
  fi

  # `--no-deps` because the client's `depends_on` reaches the server, and the
  # server owns the sqlite database. Nothing about a new web bundle is a reason
  # to go anywhere near it. A bare `up -d` here would take the whole stack.
  #
  # This is a no-op when the pull brought nothing new: compose only recreates a
  # container whose image id has moved.
  if ! docker compose --progress quiet "${args[@]}" "${profile[@]}" up -d --no-deps "$service"; then
    log "[$tag] up failed"
    return 1
  fi

  image_after=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)
  id_after=$(docker inspect --format '{{.Id}}' "$container" 2>/dev/null || echo none)

  if [[ "$image_before" != "$image_after" ]]; then
    log "[$tag] new image ${image_before:0:19} -> ${image_after:0:19}"
  elif [[ "$id_before" != "$id_after" ]]; then
    log "[$tag] recreated on the same image (${image_after:0:19}) — the service definition changed"
  else
    log "[$tag] already current (${image_after:0:19})"
  fi
}

status=0
for stack in $STACKS; do
  for service in $SERVICES; do
    refresh "$stack" "$service" || status=1
  done
done

for container in $CONTAINERS; do
  refresh_named "$container" || status=1
done

# Nothing is removed here on purpose. Each superseded client image is left
# dangling, which is about 30MB a release, and no rule on this box lets a script
# delete images — the disk it would be freeing is the one the auth database sits
# on. Reclaiming it stays a decision somebody makes while looking at
# `docker image ls`.

exit "$status"
