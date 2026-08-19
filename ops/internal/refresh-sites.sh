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

# A build that fails on a given commit will fail on it again. Retrying is still
# worth doing, because some failures are a registry timeout during install
# rather than a broken Dockerfile, but retrying at the same rate forever is not:
# a genuinely broken commit cost about 30 seconds of CPU every ten minutes for
# as long as it stayed broken (GRYT-364).
#
# So the gap doubles from one timer interval, up to a cap. Eight failures gets
# it to roughly a day, which is about when somebody should have noticed anyway.
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
#
# The unit runs as root and these repositories belong to the person who cloned
# them. Since 2.35.2 git refuses to work inside a repository owned by somebody
# else, and that default is right: it stops root running hooks and config it
# does not control. Every git call here failed on the first install because of
# it, and nothing was ever deployed.
#
# Dropping to the owner is the way round it that does not give anything up.
# Marking the paths safe.directory for root would also work, and would leave
# root-owned objects behind in somebody else's repository the first time it
# fetched. Only git needs this; docker stays as root, which is what it needs to
# reach the socket.
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
  local context repo head target built state dirty
  local failed_state failed_commit attempts first_failed next_try now

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

  # Both streams into the variable, so a refusal is reported as what git
  # actually said. Hiding stderr here turned "dubious ownership" into "not in a
  # git repository", which pointed at the path when the problem was the user.
  if ! repo=$(git_in "$context" rev-parse --show-toplevel 2>&1); then
    log "[$service] cannot read a git repository at $context: $repo"
    return 1
  fi

  # Tracked changes only. These checkouts collect .next, node_modules and build
  # output, so a plain porcelain would report every one of them as dirty
  # forever and this would never run.
  #
  # Checked separately from the emptiness test, because a git that failed also
  # prints nothing, and "clean" is the one answer a failure must not produce.
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

  # These are called in a `|| status=1` context, where set -e does not apply, so
  # a failure would otherwise carry on with an empty commit and compare it
  # against the state file.
  if ! head=$(git_in "$repo" rev-parse HEAD 2>&1) ||
     ! target=$(git_in "$repo" rev-parse FETCH_HEAD 2>&1); then
    log "[$service] cannot resolve commits in $repo — skipped"
    return 1
  fi

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

  # Nothing here is cheap from this point on, so the commit that failed last
  # time gets checked before the disk, the checkout and the build.
  failed_state="${STATE_DIR}/${service}.failed"
  now=$(date +%s)
  read -r failed_commit attempts first_failed next_try < <(
    cat "$failed_state" 2>/dev/null || echo "none 0 0 0"
  )

  if [[ "$failed_commit" == "$target" ]] && (( now < next_try )); then
    # Still non-zero, so the unit stays failed for as long as the site is stale.
    # Skipping the build saves the CPU; pretending it succeeded would hide that
    # a site is sitting on old source, which is the thing this timer exists to
    # stop happening.
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
    # some are detached. Both of these refuse rather than discard anything, so a
    # checkout that has been moved somewhere on purpose stays where it is.
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

# Superseded images are left dangling, the same as in refresh-web-client.sh, and
# these are bigger. Reclaiming them stays something somebody does while looking
# at `docker image ls`, because the disk being freed is the one Keycloak is on.

exit "$status"
