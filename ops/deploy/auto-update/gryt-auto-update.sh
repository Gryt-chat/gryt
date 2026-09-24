#!/usr/bin/env bash
# Keep a self-hosted Gryt Docker Compose deployment on the image its release
# channel publishes. ops/internal/refresh-web-client.sh wraps this with Gryt's own defaults.

# Install with install.sh, or run by hand. Only ever refreshes a container
# that is already there, and defers the SFU while anybody is in voice.

# GRYT_STACKS as gryt-<stack>-<service> (unset auto-detects, "" means none).
# GRYT_SERVICES, GRYT_CONTAINERS, GRYT_PROFILES and GRYT_MIN_FREE_GB (10) below.

set -euo pipefail

DEFAULT_SERVICES="sfu server image-worker client"

if [[ -z "${GRYT_STACKS+x}" ]]; then
  STACKS=$(docker ps --format '{{.Names}}' 2>/dev/null \
    | sed -n 's/^gryt-\(.*\)-server$/\1/p' | sort -u | tr '\n' ' ')
else
  STACKS="$GRYT_STACKS"
fi
SERVICES="${GRYT_SERVICES:-${GRYT_SERVICE:-$DEFAULT_SERVICES}}"
CONTAINERS="${GRYT_CONTAINERS:-}"
read -r -a PROFILE_ARGS <<<"$(for p in ${GRYT_PROFILES:-}; do printf -- '--profile %s ' "$p"; done)"
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null || true
}

# How many people are in voice on this stack, or empty if it cannot be read.
# `docker exec` rather than a published port: the SFU deliberately never publishes it.
sfu_peers() {
  local container="$1" port
  port=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null \
    | sed -n 's/^SFU_METRICS_PORT=//p' | head -1)

  # Unset means an SFU too old to have the setting; 0 means metrics are served
  # nowhere. Either way the caller defers rather than guessing.
  [[ -z "$port" || "$port" == "0" ]] && return 0

  docker exec "$container" sh -c \
    "wget -qO- http://127.0.0.1:${port}/metrics 2>/dev/null || curl -sf --max-time 5 http://127.0.0.1:${port}/metrics" 2>/dev/null \
    | awk '/^gryt_sfu_peers_active /{print $2; found=1} END{if(!found) exit 1}'
}

# The stack form: gryt-<stack>-<service>.
refresh() {
  refresh_container "gryt-${1}-${2}" "$2" "${1}/${2}"
}

# The general form. Everything comes off the container itself, so one outside
# a stack needs no more configuration than its name.
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
  local -a args=()
  local config_files env_file working_dir f free_gb
  local image_before image_after id_before id_after

  # Read the stack's shape off the container. Some overlays are untracked and
  # exist only on this machine, so no list in the repo could be right.
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

  # A pull that fills the disk can take down whatever else lives on it.
  free_gb=$(df -BG --output=avail "${working_dir:-/}" | tail -1 | tr -dc '0-9')
  if (( free_gb < MIN_FREE_GB )); then
    log "[$tag] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to pull"
    return 1
  fi

  # Both, because they answer different questions: the image id says whether a
  # new release arrived, the container id whether compose replaced it at all.
  image_before=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)
  id_before=$(docker inspect --format '{{.Id}}' "$container" 2>/dev/null || echo none)

  # Naming a service behind a profile that is not passed in GRYT_PROFILES is a
  # silent no-op, so this fails with "no such service" rather than pulling.
  if ! docker compose --progress quiet "${args[@]}" "${PROFILE_ARGS[@]}" pull --quiet "$service"; then
    log "[$tag] pull failed — leaving the running container alone"
    return 1
  fi

  # Would `up` actually replace this container? Asked before the gate below,
  # so nobody waits for a recreate that was not going to happen.
  local image_ref pulled_id
  image_ref=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || echo "")
  pulled_id=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null || echo "")

  # The SFU is the one service whose recreate is felt, so wait for the channel
  # to empty rather than cutting anybody off. An unreadable count defers too.
  if [[ "$service" == "sfu" && -n "$pulled_id" && "$pulled_id" != "$image_before" ]]; then
    local peers move="${image_before:0:19} -> ${pulled_id:0:19}"
    peers=$(sfu_peers "$container") || peers=""
    if [[ -z "$peers" ]]; then
      log "[$tag] update available ($move), peer count unreadable — deferring"
      return 0
    fi
    if [[ "${peers%%.*}" -gt 0 ]]; then
      log "[$tag] update available ($move), ${peers%%.*} in voice — deferring"
      return 0
    fi
    log "[$tag] update available ($move), 0 in voice — updating"
  fi

  # `--no-deps`, because nothing about one service's new image is a reason to
  # go near the others. A no-op when the pull brought nothing new.
  if ! docker compose --progress quiet "${args[@]}" "${PROFILE_ARGS[@]}" up -d --no-deps "$service"; then
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
if [[ -z "$STACKS" && -z "$CONTAINERS" ]]; then
  log "no gryt-*-server containers found and GRYT_CONTAINERS is empty — nothing to refresh"
fi

for stack in $STACKS; do
  for service in $SERVICES; do
    refresh "$stack" "$service" || status=1
  done
done

for container in $CONTAINERS; do
  refresh_named "$container" || status=1
done

# Nothing is removed here on purpose. Reclaiming that disk stays a decision
# you make while looking at `docker image ls`.

exit "$status"
