#!/usr/bin/env bash
# Rebuild the sites built from source when their source moves. docs, site and ui
# are `build:` contexts, so merging a PR changes nothing running (GRYT-360).

# No registry to ask whether a digest moved, so this fetches each submodule and
# remembers what it last built. Run from the systemd timer beside this script.

# One named service at a time, never a bare `up -d`: the same compose file
# defines Fider and its Postgres, and a timer has no business recreating a database.

# GRYT_SITES (docs site ui), GRYT_SITES_PROJECT (internal), GRYT_SITES_BRANCH
# (main), GRYT_SITES_STATE (/var/lib/gryt-sites-refresh), GRYT_MIN_FREE_GB (20).

set -euo pipefail

SITES="${GRYT_SITES:-docs site ui}"
PROJECT="${GRYT_SITES_PROJECT:-internal}"
BRANCH="${GRYT_SITES_BRANCH:-main}"
STATE_DIR="${GRYT_SITES_STATE:-/var/lib/gryt-sites-refresh}"

# Higher than the web client's 10: these run Next.js and Bun builds inside
# Docker. The disk being filled is the one the Keycloak database sits on.
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-20}"

# A build that fails on a commit fails on it again, and retrying at the same rate
# forever cost 30 seconds of CPU every ten minutes while it stayed broken.

# So the gap doubles from one timer interval, up to a cap. Eight failures is
# roughly a day (GRYT-364).
RETRY_BASE_SECONDS="${GRYT_RETRY_BASE_SECONDS:-600}"
RETRY_CAP_SECONDS="${GRYT_RETRY_CAP_SECONDS:-86400}"

# systemd's default PATH covers /usr/sbin, but this is also meant to be runnable
# by hand from a shell where it is not on the path.
RUNUSER=$(command -v runuser || echo /usr/sbin/runuser)
[[ -x "$RUNUSER" ]] || RUNUSER=""

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

# How long to wait after this many consecutive failures. Doubling, capped.
# Separate from everything else so it can be checked without a Docker daemon.
retry_delay() {
  local attempts="$1"
  local delay="$RETRY_BASE_SECONDS"
  local i

  for (( i = 1; i < attempts; i++ )); do
    delay=$(( delay * 2 ))
    if (( delay >= RETRY_CAP_SECONDS )); then
      printf '%s' "$RETRY_CAP_SECONDS"
      return
    fi
  done

  printf '%s' "$delay"
}

label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$2\"}}" "$1" 2>/dev/null || true
}

# git, as whoever owns the checkout.

# The unit runs as root and these repositories belong to whoever cloned them.
# Since 2.35.2 git refuses to work in a repository owned by somebody else.

# Dropping to the owner rather than marking them safe.directory, which would leave
# root-owned objects behind. Only git needs this; docker stays root for the socket.
git_in() {
  local dir="$1"
  shift
  local owner

  owner=$(stat -c '%U' "$dir" 2>/dev/null || true)

  # Already the right user, or nothing to go on. Either way, let git speak for
  # itself rather than guessing.
  if [[ -z "$owner" || "$owner" == "$(id -un)" ]]; then
    git -C "$dir" "$@"
    return
  fi

  # Not the owner and not able to become anybody. git will refuse, and its own
  # message about it is better than one made up here.
  if [[ "$(id -u)" != "0" ]]; then
    git -C "$dir" "$@"
    return
  fi

  if [[ -z "$RUNUSER" ]]; then
    log "runuser is not installed, so git cannot be run as $owner"
    return 1
  fi

  "$RUNUSER" -u "$owner" -- git -C "$dir" "$@"
}

# The source directory for a service, taken from the merged compose config. A
# service-to-submodule map would be a second place to change when one moves.
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
  local context repo head target built state dirty
  local failed_state failed_commit attempts first_failed next_try now

  # Same as refresh-web-client.sh: the overlay list and its order decide the
  # merged config, so anything else makes `up` recreate every ten minutes.
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

  # Both streams into the variable. Hiding stderr turned "dubious ownership" into
  # "not in a git repository", which pointed at the path rather than the user.
  if ! repo=$(git_in "$context" rev-parse --show-toplevel 2>&1); then
    log "[$service] cannot read a git repository at $context: $repo"
    return 1
  fi

  # Tracked changes only: these checkouts collect .next and node_modules, so a
  # plain porcelain would report dirty forever and this would never run.

  # Checked separately from the emptiness test, because a git that failed also
  # prints nothing and "clean" is the one answer a failure must not produce.
  if ! dirty=$(git_in "$repo" status --porcelain --untracked-files=no 2>&1); then
    log "[$service] cannot read the state of $repo: $dirty"
    return 1
  fi

  if [[ -n "$dirty" ]]; then
    log "[$service] $repo has local modifications — leaving it alone"
    return 1
  fi

  if ! git_in "$repo" fetch --quiet origin "$BRANCH"; then
    log "[$service] fetch failed — leaving the running container alone"
    return 1
  fi

  # Called in a `|| status=1` context where set -e does not apply, so a failure
  # would otherwise carry on with an empty commit.
  if ! head=$(git_in "$repo" rev-parse HEAD 2>&1) ||
     ! target=$(git_in "$repo" rev-parse FETCH_HEAD 2>&1); then
    log "[$service] cannot resolve commits in $repo — skipped"
    return 1
  fi

  # No registry to ask what is deployed, so it is written down. Missing means
  # unknown rather than current: the running container is of unknown vintage.
  state="${STATE_DIR}/${service}.commit"
  built=$(cat "$state" 2>/dev/null || echo unknown)

  if [[ "$built" == "$target" && "$head" == "$target" ]]; then
    log "[$service] already on ${target:0:12}"
    return 0
  fi

  # Nothing here is cheap from this point on, so the commit that failed last
  # time gets checked before the disk, the checkout and the build.
  failed_state="${STATE_DIR}/${service}.failed"
  now=$(date +%s)
  read -r failed_commit attempts first_failed next_try < <(
    cat "$failed_state" 2>/dev/null || echo "none 0 0 0"
  )

  if [[ "$failed_commit" == "$target" ]] && (( now < next_try )); then
    # Still non-zero, so the unit stays failed while the site is stale. Pretending
    # it succeeded would hide old source, which is what this timer exists to stop.
    log "[$service] ${target:0:12} has failed to build ${attempts}x since $(date -Is -d "@${first_failed}"), next attempt $(date -Is -d "@${next_try}")"
    return 1
  fi

  free_gb=$(df -BG --output=avail "${working_dir:-/}" | tail -1 | tr -dc '0-9')
  if (( free_gb < MIN_FREE_GB )); then
    log "[$service] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to build"
    return 1
  fi

  if [[ "$head" != "$target" ]]; then
    # Both shapes exist on the box: some submodules sit on a tracking branch and
    # some are detached. Both refuse rather than discard anything.
    if git_in "$repo" symbolic-ref --quiet HEAD >/dev/null; then
      if ! git_in "$repo" merge --ff-only --quiet FETCH_HEAD; then
        log "[$service] cannot fast-forward to ${target:0:12} — skipped"
        return 1
      fi
    elif ! git_in "$repo" checkout --detach --quiet FETCH_HEAD; then
      log "[$service] cannot check out ${target:0:12} — skipped"
      return 1
    fi
    log "[$service] source ${head:0:12} -> ${target:0:12}"
  else
    log "[$service] source is ${target:0:12}, last built ${built:0:12} — rebuilding"
  fi

  if ! docker compose --progress quiet "${args[@]}" build "$service"; then
    # A different commit than the one that failed before starts the count again,
    # so a fix that does not work still gets its own full set of attempts.
    if [[ "$failed_commit" != "$target" ]]; then
      attempts=0
      first_failed="$now"
    fi
    attempts=$(( attempts + 1 ))

    mkdir -p "$STATE_DIR"
    printf '%s %s %s %s\n' \
      "$target" "$attempts" "$first_failed" "$(( now + $(retry_delay "$attempts") ))" \
      > "$failed_state"

    log "[$service] build failed (${attempts}x) — leaving the running container alone"
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
  rm -f "$failed_state"

  log "[$service] deployed ${target:0:12}"
}

status=0
for site in $SITES; do
  refresh "$site" || status=1
done

# Superseded images are left dangling, the same as refresh-web-client.sh. The
# disk being freed is the one Keycloak is on.

exit "$status"
