#!/usr/bin/env bash
#
# Fast-forward the superproject checkout so ops/ changes reach the machine.
#
# Everything else on this box updates itself. The sites refresher fetches the
# docs, site and ui submodules; the web client refresher asks GHCR for a newer
# image. Nothing pulled the superproject, so ops/ was the one directory where
# merging a pull request changed nothing here at all.
#
# That is not academic. On 2026-08-21 the checkout sat six merges behind while
# three of them were compose changes, and the refresher scripts themselves are
# symlinked out of this checkout, so a change to those could never take effect
# either. A script that cannot deliver its own updates is a poor place to put
# the delivery mechanism.
#
# Which is also why this is its own file rather than a few lines inside
# refresh-sites.sh. Bash reads a script as it runs it, so a script that pulls
# the checkout it lives in can have its own remaining lines replaced underneath
# it. This one is short enough to be read in a single go, and it is run from
# ExecStartPre so the refresher that follows is a fresh process reading whatever
# the pull just left behind.
#
# Deliberately fast-forward only, and deliberately --no-recurse-submodules. The
# submodules are the sites refresher's business and it moves them to commits the
# gitlinks here do not name; recursing would drag them backwards to whatever the
# superproject last recorded, which is the opposite of what everything else on
# this box is trying to do.
#
# Refuses on any local commit or tracked modification rather than resolving it.
# Nothing here should be editing this checkout, and if something is, standing on
# it is worse than doing nothing.

set -euo pipefail

# Where the checkout is.
#
# Worked out from this script's own path rather than named, because it is
# symlinked into /usr/local/bin from inside the checkout it maintains — so it
# already knows, and every install that follows the README is that shape.
#
# It used to default to one machine's home directory, which is wrong for anybody
# else and is not something a public repository should be carrying at all.
#
# GRYT_ROOT still wins, for an install that copies the script instead.
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

# Tracked changes only. Submodule gitlinks read as modified here as a matter of
# course, because the sites refresher moves the submodules without committing
# them, so those are not a reason to refuse.
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
