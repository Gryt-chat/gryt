#!/usr/bin/env bash
#
# Rebuild the sites that are built from source when their source moves.
#
# docs.gryt.chat, gryt.chat and ui.gryt.chat are not images somebody pushed.
# They are `build:` contexts in ops/internal/docker-compose.yml pointing at the
# docs, site and ui submodules, so merging a pull request changes nothing that
# is running until a person SSHes in and rebuilds. Merging the @gryt/voice
# documentation and finding docs.gryt.chat unchanged afterwards is what
# prompted this (GRYT-360).
#
# refresh-web-client.sh is the same idea for app.gryt.chat, and it can just ask
# GHCR whether the digest moved. There is no registry to ask here, so this
# fetches each submodule instead and remembers what it last built.
#
# Run from the systemd timer beside this script. Safe to run by hand.
#
# Deliberately narrow, for the same reasons as the web client script. It builds
# and recreates one named service at a time, never a bare `up -d`: the same
# compose file defines Fider and its Postgres, and a timer has no business
# recreating a database. It only refreshes containers that are already running,
# because it does not know what a missing one was supposed to look like.
#
# Environment:
#   GRYT_SITES         compose services to refresh, space separated.
#                      Default "docs site ui".
#   GRYT_SITES_PROJECT compose project the containers belong to.
#                      Default "internal".
#   GRYT_SITES_BRANCH  branch to follow in each submodule. Default "main".
#   GRYT_SITES_STATE   where to remember the commit last built per service.
#                      Default /var/lib/gryt-sites-refresh.
#   GRYT_MIN_FREE_GB   refuse to build below this much free disk. Default 20.

set -euo pipefail

SITES="${GRYT_SITES:-docs site ui}"
PROJECT="${GRYT_SITES_PROJECT:-internal}"
BRANCH="${GRYT_SITES_BRANCH:-main}"
STATE_DIR="${GRYT_SITES_STATE:-/var/lib/gryt-sites-refresh}"

# Higher than the web client's 10. That one pulls a 30MB nginx image; these run
# a Next.js and a Bun build inside Docker, which wants room for a node_modules
# tree and a layer cache. The disk it would be filling is the one the Keycloak
# database sits on.
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-20}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null || true
}

# The source directory for a service, taken from the merged compose config
# rather than from a table in here. A map of service to submodule would be a
# second place to change when one of them moves, and it would be the place
# nobody remembers.
build_context() {
  docker compose "${@:2}" config --format json 2>/dev/null |
    python3 -c '
import json, sys
service = sys.argv[1]
config = json.load(sys.stdin)
build = config.get("services", {}).get(service, {}).get("build") or {}
print(build.get("context", ""))
' "$1"
}

refresh() {
  local service="$1"
  local container="${PROJECT}-${service}-1"
  local -a args=()
  local config_files env_file working_dir f free_gb
  local context repo head target built state

  # Same trick as refresh-web-client.sh: the overlay list and its order decide
  # what the merged config is, so anything other than what the stack actually
  # came up with would make `up` recreate the container every ten minutes.
  config_files=$(label "$container" "project.config_files")
  if [[ -z "$config_files" ]]; then
    log "[$service] no container named $container — skipped"
    return 0
  fi

  working_dir=$(label "$container" "project.working_dir")
  env_file=$(label "$container" "project.environment_file")

  [[ -n "$env_file" ]] && args+=(--env-file "$env_file")

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ ! -f "$f" ]]; then
      log "[$service] $f is gone since the stack came up — skipped"
      return 1
    fi
    args+=(-f "$f")
  done < <(tr ',' '\n' <<<"$config_files")

  context=$(build_context "$service" "${args[@]}")
  if [[ -z "$context" || ! -d "$context" ]]; then
    log "[$service] no build context in the compose config — skipped"
    return 1
  fi

  if ! repo=$(git -C "$context" rev-parse --show-toplevel 2>/dev/null); then
    log "[$service] $context is not in a git repository — skipped"
    return 1
  fi

  # Tracked changes only. These checkouts collect .next, node_modules and build
  # output, so a plain porcelain would report every one of them as dirty
  # forever and this would never run.
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]; then
    log "[$service] $repo has local modifications — leaving it alone"
    return 1
  fi

  if ! git -C "$repo" fetch --quiet origin "$BRANCH"; then
    log "[$service] fetch failed — leaving the running container alone"
    return 1
  fi

  head=$(git -C "$repo" rev-parse HEAD)
  target=$(git -C "$repo" rev-parse FETCH_HEAD)

  # No registry to ask what is deployed, so the answer is written down. Missing
  # is treated as unknown rather than as up to date, which means the first run
  # after installing this rebuilds once. That is the right answer anyway: the
  # running container is of unknown vintage until something has built it.
  state="${STATE_DIR}/${service}.commit"
  built=$(cat "$state" 2>/dev/null || echo unknown)

  if [[ "$built" == "$target" && "$head" == "$target" ]]; then
    log "[$service] already on ${target:0:12}"
    return 0
  fi

  free_gb=$(df -BG --output=avail "${working_dir:-/}" | tail -1 | tr -dc '0-9')
  if (( free_gb < MIN_FREE_GB )); then
    log "[$service] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to build"
    return 1
  fi

  if [[ "$head" != "$target" ]]; then
    # Both shapes exist on the box: some submodules sit on a tracking branch and
    # some are detached. Both of these refuse rather than discard anything, so a
    # checkout that has been moved somewhere on purpose stays where it is.
    if git -C "$repo" symbolic-ref --quiet HEAD >/dev/null; then
      if ! git -C "$repo" merge --ff-only --quiet FETCH_HEAD; then
        log "[$service] cannot fast-forward to ${target:0:12} — skipped"
        return 1
      fi
    elif ! git -C "$repo" checkout --detach --quiet FETCH_HEAD; then
      log "[$service] cannot check out ${target:0:12} — skipped"
      return 1
    fi
    log "[$service] source ${head:0:12} -> ${target:0:12}"
  else
    log "[$service] source is ${target:0:12}, last built ${built:0:12} — rebuilding"
  fi

  if ! docker compose --progress quiet "${args[@]}" build "$service"; then
    log "[$service] build failed — leaving the running container alone"
    return 1
  fi

  # --no-deps and one named service, so Fider and its Postgres are never in the
  # way of a documentation change.
  if ! docker compose --progress quiet "${args[@]}" up -d --no-deps "$service"; then
    log "[$service] up failed"
    return 1
  fi

  # Only after `up` has succeeded. Writing it earlier would record a deploy that
  # did not happen, and the next run would agree with it.
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$target" > "$state"

  log "[$service] deployed ${target:0:12}"
}

status=0
for site in $SITES; do
  refresh "$site" || status=1
done

# Superseded images are left dangling, the same as in refresh-web-client.sh, and
# these are bigger. Reclaiming them stays something somebody does while looking
# at `docker image ls`, because the disk being freed is the one Keycloak is on.

exit "$status"
