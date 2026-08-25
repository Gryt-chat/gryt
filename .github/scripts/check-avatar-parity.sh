#!/usr/bin/env bash
#
# Fails when the desktop client and the mobile app would draw avatars from
# different copies of @gryt/owl.
#
# Neither repository can answer this on its own. The client's tests run against
# the client's node_modules and mobile's run against mobile's, so both stay
# green while the two resolve different versions — which is the failure the
# package exists to prevent, one person drawn as two different people. It has
# happened once already, quietly, while a test holding copied hashes passed.
#
# Usage: check-avatar-parity.sh [package ...]      (default: @gryt/owl)
#
# Reads the two yarn.lock files in place. The caller is responsible for having
# packages/client and packages/mobile checked out at whatever refs it wants
# compared; this script has no opinion about that.

set -euo pipefail

ROOT="${GRYT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Keep the labels and the paths together — a mismatch report that names the
# wrong app sends somebody to the wrong repository.
APPS=(
  "desktop client:$ROOT/packages/client/yarn.lock"
  "mobile app:$ROOT/packages/mobile/yarn.lock"
)

PACKAGES=("$@")
if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  PACKAGES=("@gryt/owl")
fi

# Pulls every top-level entry for one package out of a yarn v1 lockfile, as
# "version<TAB>integrity" lines — one per entry, because more than one is
# itself a finding (see below).
#
# Matching is anchored to column 0 on purpose. The same name also appears
# indented under `dependencies:` of whatever depends on it, and those lines
# carry a range rather than a resolved version.
extract() {
  local lockfile="$1" pkg="$2"

  awk -v pkg="$pkg" '
    # A block header is any unindented line. Entering one clears the state from
    # the previous block, so a version or integrity belonging to some other
    # package can never leak into this one.
    /^[^[:space:]]/ {
      # Yarn folds compatible ranges into one header:
      #   "@gryt/owl@^0.1.0", "@gryt/owl@0.1.2":
      # so look for the name followed by @, anywhere on the line.
      want = index($0, "\"" pkg "@") > 0
      version = ""
      integrity = ""
      next
    }

    !want { next }

    $1 == "version" {
      version = $2
      gsub(/"/, "", version)
    }

    $1 == "integrity" {
      integrity = $2
    }

    # Emit once both halves are in hand. Yarn writes version before integrity,
    # and integrity is the last of the two, so this fires exactly once per
    # block. A registry that omits integrity would simply never print, which
    # the caller reports as "not found" rather than as a silent pass.
    version != "" && integrity != "" {
      print version "\t" integrity
      version = ""
      integrity = ""
    }
  ' "$lockfile"
}

failed=0

for entry in "${APPS[@]}"; do
  lockfile="${entry#*:}"

  if [[ ! -f "$lockfile" ]]; then
    echo "::error::No lockfile at $lockfile — is the submodule checked out?" >&2
    exit 1
  fi

  # If yarn ever moves to berry the format changes completely and every lookup
  # below starts returning nothing. That reads as "package not found", which is
  # a confusing way to be told the parser is obsolete.
  if ! head -5 "$lockfile" | grep -q "yarn lockfile v1"; then
    echo "::error::$lockfile is not a yarn v1 lockfile — this parser needs rewriting." >&2
    exit 1
  fi
done

for pkg in "${PACKAGES[@]}"; do
  echo "== $pkg"

  declare -a versions=()
  declare -a integrities=()

  for entry in "${APPS[@]}"; do
    label="${entry%%:*}"
    lockfile="${entry#*:}"

    # Not mapfile: this has to run on the bash 3.2 that ships with macOS as
    # well as on the bash 5 in CI, and mapfile is bash 4.
    found=()
    while IFS= read -r line; do
      found+=("$line")
    done < <(extract "$lockfile" "$pkg")

    if [[ ${#found[@]} -eq 0 ]]; then
      echo "   $label: not in the lockfile"
      echo "::error::$pkg is not resolved in $lockfile"
      failed=1
      versions+=("")
      integrities+=("")
      continue
    fi

    # More than one entry means this app resolved the package twice and ships
    # both — the same person drawn two ways inside a single app, before the two
    # apps are even compared. Yarn does this when the app's range and a
    # dependency's range don't overlap.
    if [[ ${#found[@]} -gt 1 ]]; then
      echo "   $label: ${#found[@]} separate resolutions"
      printf '     %s\n' "${found[@]}"
      echo "::error::$pkg resolves to ${#found[@]} versions inside $lockfile — dedupe it first"
      failed=1
    fi

    version="${found[0]%%$'\t'*}"
    integrity="${found[0]#*$'\t'}"

    # Already printed above in the multi-resolution case, and printing one of
    # them a second time as if it were the answer only muddies the report.
    if [[ ${#found[@]} -eq 1 ]]; then
      echo "   $label: $version"
    fi

    versions+=("$version")
    integrities+=("$integrity")
  done

  if [[ -n "${versions[0]}" && -n "${versions[1]}" ]]; then
    if [[ "${versions[0]}" != "${versions[1]}" ]]; then
      echo "::error::$pkg differs — desktop client ${versions[0]}, mobile app ${versions[1]}"
      failed=1
    elif [[ "${integrities[0]}" != "${integrities[1]}" ]]; then
      # Same version number, different tarball. npm does not allow republishing
      # a version, so this is either a proxy serving something else or one of
      # the two locks being stale in a way the version alone cannot show.
      echo "::error::$pkg is ${versions[0]} in both, but the integrity hashes differ:"
      echo "::error::  desktop client ${integrities[0]}"
      echo "::error::  mobile app     ${integrities[1]}"
      failed=1
    fi
  fi

  unset versions integrities
done

if [[ $failed -ne 0 ]]; then
  echo
  echo "The two apps would not draw the same avatars. Put both on one version" >&2
  echo "and commit the lockfiles." >&2
  exit 1
fi

echo
echo "Both apps resolve the same avatar package."
