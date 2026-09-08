#!/usr/bin/env bash
# Keep the hosted stacks on the image the last release published. Nothing ever
# pulled it, so app.gryt.chat served 1.5.6 against a 1.6.15 app (GRYT-291).

# Run from the systemd timer beside this script; safe to run by hand. It only
# ever refreshes a container that is already there, and never touches `auth`.

# The SFU is recreated only when nobody is in voice on that stack, because that
# drops every call. Servers reconnect through session:restore, so they need no gate.

# GRYT_STACKS (prod beta), GRYT_SERVICES as <stack>/<service>, GRYT_CONTAINERS for
# anything outside that naming, GRYT_MIN_FREE_GB (10) to refuse a pull.

set -euo pipefail

STACKS="${GRYT_STACKS:-prod beta}"
# Ordered so the media plane and the servers land before the client that talks
# to them.
DEFAULT_SERVICES="sfu server server-nt server-pp image-worker image-worker-nt image-worker-pp client"
SERVICES="${GRYT_SERVICES:-${GRYT_SERVICE:-$DEFAULT_SERVICES}}"
# Containers carrying a released image that are not part of a stack. Nothing
# pulled the report inbox until this line existed.
CONTAINERS="${GRYT_CONTAINERS:-gryt-reports}"
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null || true
}

# How many people are in voice on this stack, or empty if it cannot be read.

# `docker exec` rather than a published port: the metrics listener is a second
# port the SFU logs as "container-only; do not publish this port".

# Asking host port 5005 instead — the signalling port — came back empty, so every
# run deferred and no SFU was ever updated, silently, for four days.

# wget or curl: the image has one of them, and which is not worth pinning a base
# image over.
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

# The stack form: gryt-<stack>-<service>, refreshed with the `web` profile
# enabled because the client service sits behind it.
refresh() {
  refresh_container "gryt-${1}-${2}" "$2" "${1}/${2}" --profile web
}

# The general form. Everything comes off the container itself, so one outside a
# stack needs no more configuration than its name.
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

  # Read the stack's shape off the container. Compose merges overlays left to
  # right, so a different list is a different merged config and `up` recreates.

  # Some overlays are untracked and exist only on this machine, so no list in the
  # repo could be right. The labels are what the stack was brought up with.
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

  # The auth database sits on the same disk, so a pull that fills it takes
  # Keycloak down with it.
  free_gb=$(df -BG --output=avail "${working_dir:-/}" | tail -1 | tr -dc '0-9')
  if (( free_gb < MIN_FREE_GB )); then
    log "[$tag] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to pull"
    return 1
  fi

  # Both, because they answer different questions: the image id says whether a
  # new release arrived, the container id whether compose replaced it at all.
  image_before=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || echo none)
  id_before=$(docker inspect --format '{{.Id}}' "$container" 2>/dev/null || echo none)

  # `--progress quiet` because this runs every ten minutes and journald does not
  # need three lines each time to say nothing happened. Errors still come through.

  # `--profile web` because the client sits behind that profile; naming a service
  # in a profile that is not enabled is a silent no-op rather than an error.
  if ! docker compose --progress quiet "${args[@]}" "${profile[@]}" pull --quiet "$service"; then
    log "[$tag] pull failed — leaving the running container alone"
    return 1
  fi

  # Would `up` actually replace this container? Asked before the gate below, so
  # nobody waits for a recreate that was not going to happen.
  local image_ref pulled_id
  image_ref=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || echo "")
  pulled_id=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null || echo "")

  # The SFU is the one service whose recreate is felt, so wait for the channel to
  # empty rather than cutting anybody off. The next tick is ten minutes away.

  # An unreadable peer count defers too, and every line names both images and the
  # count so the log says why the SFU is still on last week's build.
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

  # `--no-deps` because the client's `depends_on` reaches the server, which owns
  # the sqlite database. A bare `up -d` here would take the whole stack.

  # A no-op when the pull brought nothing new: compose only recreates a container
  # whose image id has moved.
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

# Nothing is removed here on purpose — 30MB a release left dangling. The disk it
# would free is the one the auth database sits on.

exit "$status"
