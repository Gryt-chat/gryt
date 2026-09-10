#!/usr/bin/env bash

# Puts a submodule on its newest release tag for a channel. Release Client and Release
# Server both call this, so they can't ship different SFU or image worker commits.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: checkout-release-tag.sh <submodule path> <beta|latest>" >&2
  exit 2
fi

path="$1"
channel="$2"

# Beta takes plain releases too, so a stable newer than the last beta wins.
case "$channel" in
  beta) pattern='v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?' ;;
  latest) pattern='v[0-9]+\.[0-9]+\.[0-9]+' ;;
  *)
    echo "::error::Unknown channel '$channel'. Expected beta or latest."
    exit 2
    ;;
esac

git -C "$path" fetch --quiet origin main --tags --force

# versionsort.suffix makes -v:refname semver precedence rather than string order, or
# v1.6.15-beta.1 sorts above v1.6.15. `|| true` because grep exits 1 on no match.
tag=$(git -C "$path" \
    -c versionsort.suffix=-alpha \
    -c versionsort.suffix=-beta \
    -c versionsort.suffix=-rc \
    tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname \
  | grep -Ex "$pattern" \
  | head -1 || true)

if [[ -z "$tag" ]]; then
  echo "::error::No release tag in $path for the $channel channel. Release it first."
  exit 1
fi

# Detached on purpose: this is a point in history, not a branch to carry on from.
git -C "$path" checkout --detach --quiet "$tag"
echo "$path -> $(git -C "$path" rev-parse --short HEAD) ($tag)"
