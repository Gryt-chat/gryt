#!/usr/bin/env bash
# Fast-forward the superproject checkout so ops/ changes reach the machine.
# Nothing pulled it, so merging a pull request changed nothing here at all.

# On 2026-08-21 the checkout sat six merges behind, three of them compose changes,
# and the refresher scripts are symlinked out of it, so those could not update either.

# Its own file rather than lines inside refresh-sites.sh: bash reads a script as it
# runs, so this is short and runs from ExecStartPre, leaving the refresher fresh.

# Fast-forward only and --no-recurse-submodules — recursing would drag the
# submodules back to the gitlinks, which is what the sites refresher moves them off.

# Refuses on any local commit or tracked modification. Nothing should be editing
# this checkout, and if something is, standing on it is worse than doing nothing.

set -euo pipefail

# Where the checkout is. Worked out from this script's own path, because it is
# symlinked into /usr/local/bin from inside the checkout it maintains.

# It used to default to one machine's home directory. GRYT_ROOT still wins, for an
# install that copies the script instead.
SELF=$(readlink -f "${BASH_SOURCE[0]}")
ROOT="${GRYT_ROOT:-$(cd "$(dirname "$SELF")/../.." && pwd)}"
BRANCH="${GRYT_BRANCH:-main}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

RUNUSER=$(command -v runuser || echo /usr/sbin/runuser)
[[ -x "$RUNUSER" ]] || RUNUSER=""

git_in() {
  local owner
  owner=$(stat -c '%U' "$ROOT" 2>/dev/null || true)
  if [[ -z "$owner" || "$owner" == "$(id -un)" || "$(id -u)" != "0" ]]; then
    git -C "$ROOT" "$@"
    return
  fi
  if [[ -z "$RUNUSER" ]]; then
    log "runuser is not installed, so git cannot be run as $owner"
    return 1
  fi
  "$RUNUSER" -u "$owner" -- git -C "$ROOT" "$@"
}

[[ -d "$ROOT/.git" ]] || { log "$ROOT is not a git checkout — nothing to do"; exit 0; }

# Tracked changes only: submodule gitlinks read as modified as a matter of course,
# because the sites refresher moves them without committing.
if ! dirty=$(git_in status --porcelain --untracked-files=no -- ':!packages' 2>&1); then
  log "cannot read the state of $ROOT: $dirty"
  exit 1
fi
if [[ -n "$dirty" ]]; then
  log "$ROOT has local changes outside packages/ — leaving it alone"
  exit 0
fi

if ! git_in fetch --quiet origin "$BRANCH"; then
  log "fetch failed — leaving the checkout alone"
  exit 1
fi

before=$(git_in rev-parse HEAD)
target=$(git_in rev-parse FETCH_HEAD)
if [[ "$before" == "$target" ]]; then
  exit 0
fi

if ! git_in merge --ff-only --quiet --no-recurse-submodules FETCH_HEAD 2>/dev/null \
  && ! git_in merge --ff-only --quiet FETCH_HEAD; then
  log "cannot fast-forward $ROOT to $target — left at $before"
  exit 1
fi

log "superproject ${before:0:12} -> ${target:0:12}"
