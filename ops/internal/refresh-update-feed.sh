#!/usr/bin/env bash
#
# Mirror the current release's update files so gryt.chat can serve them.
#
# macOS downloads the whole 198MB app on every update when 84MB would do.
# electron-updater works the diff out correctly and then cannot fetch it:
#
#   Update: Full: 193,385.43 KB, To download: 84,367.41 KB (44%)
#   Update ERROR: Cannot download differentially, fallback to full download: HttpError: 501
#
# A differential download asks for the blocks that changed, which is one request
# carrying many ranges. GitHub's asset host answers a single range with a 206
# and many ranges with a 501, measured against the real asset on 2026-08-26:
#
#   Range: bytes=0-1023           -> 206, content-range bytes 0-1023/198035416
#   Range: bytes=0-1023,2048-3071 -> 501, content-length 462
#
# That is the host, not the client, and not something a client can work around.
# nginx serves multipart/byteranges, and so does the Cloudflare edge in front of
# gryt.chat — checked end to end through the real site before this was written.
#
# So this mirrors the files an update reads into the downloads folder the site
# already serves. Run from the systemd timer beside this script. Safe to run by
# hand.
#
# **A mirror, not a proxy.** Assets are immutable per version, nginx serves
# static files with full range support and no configuration at all, and
# proxy_cache with slice is more moving parts reaching the same place.
#
# **Latest only.** One release per channel, replaced when a new one publishes.
# History stays GitHub's job, and it keeps the disk bounded on a box whose other
# tenant is the Keycloak database.
#
# **Except the previous release's blockmaps.** electron-updater reads the old
# blockmap out of its own cache and downloads it from the old version's URL when
# that cache is cold — a fresh install, a cleared cache, anyone arriving from an
# older build. A 404 there is a silent fall back to the full download, which is
# the exact failure this exists to remove, and it prints nothing. A blockmap is
# 198,867 bytes against a 198,035,416-byte zip, so keeping one release of them
# costs a tenth of a percent.
#
# Environment:
#   GRYT_UPDATE_CHANNELS  channels to mirror, space separated.
#                         Default "stable beta".
#   GRYT_UPDATE_REPO      owner/repo to mirror releases from.
#                         Default "Gryt-chat/gryt".
#   GRYT_UPDATE_DIR       where the channels are written. Default is
#                         downloads/updates beside this script, which is the
#                         directory docker-compose.yml mounts into the site.
#   GRYT_UPDATE_STATE     where the release last mirrored is remembered, one
#                         file per channel. Default /var/lib/gryt-update-feed.
#   GRYT_MIN_FREE_GB      refuse to download below this much free disk.
#                         Default 10.
#   GITHUB_TOKEN          optional. Only raises the API rate limit; the mirror
#                         reads public releases and needs no permissions.

set -euo pipefail

CHANNELS="${GRYT_UPDATE_CHANNELS:-stable beta}"
REPO="${GRYT_UPDATE_REPO:-Gryt-chat/gryt}"

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_DIR="${GRYT_UPDATE_DIR:-${HERE}/downloads/updates}"
STATE_DIR="${GRYT_UPDATE_STATE:-/var/lib/gryt-update-feed}"

# Lower than the sites refresher's 20. That one runs a Next.js build inside
# Docker and wants room for a layer cache; this writes about 500MB per channel
# and needs room for one release plus the one it is replacing.
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-10}"

# The three channel files electron-updater looks for, one per platform. Which
# one a client reads is decided by the client, so all three are mirrored.
YML_NAMES=(latest.yml latest-mac.yml latest-linux.yml)

# What the updater will actually be pointed at. The dmg, deb, rpm and snap are
# for a person clicking a link on the downloads page and can keep coming from
# GitHub — mirroring them would roughly double the disk for files no update
# ever fetches.
INSTALLER_EXTENSIONS=(.zip .exe .AppImage)

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

api() {
  local url="$1"
  local -a auth=()

  [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")

  curl -sfL --max-time 30 \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: gryt-update-feed" \
    "${auth[@]}" \
    "$url"
}

# The newest release for a channel, as "<tag> <version>".
#
# stable is releases without a prerelease part; beta is whatever is newest of
# either, which is what `allowPrerelease` means to a client — somebody on beta
# who is behind a finished stable release should get that stable release.
#
# Draft releases are excluded here, and an unfinished one is excluded later by
# the asset check: a release exists from the moment the first runner uploads to
# it, and Release Client publishes from three runners over several minutes.
newest_release() {
  local channel="$1" releases

  releases=$(api "https://api.github.com/repos/${REPO}/releases?per_page=20") || return 1

  printf '%s' "$releases" | python3 -c '
import json, re, sys

channel = sys.argv[1]


def key(version):
    """Sort as a version rather than as a string, prereleases below their release."""
    core, _, pre = version.partition("-")
    numbers = [int(part) for part in core.split(".")]

    if not pre:
        # No prerelease part sorts above every prerelease of the same numbers.
        return (numbers, 1, [])

    # beta.10 after beta.9, so the numeric parts compare as numbers.
    parts = [int(p) if p.isdigit() else p for p in re.split(r"[.]", pre)]
    return (numbers, 0, parts)


best = None

for release in json.load(sys.stdin):
    if release.get("draft"):
        continue

    version = (release.get("tag_name") or "").lstrip("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?", version):
        continue

    prerelease = "-" in version
    if channel == "stable" and prerelease:
        continue

    if best is None or key(version) > key(best[1]):
        best = (release["tag_name"], version)

if best:
    print(best[0], best[1])
' "$channel"
}

# Every file the updater could ask for, given one channel yml.
#
# The yml names its installer in `path:` and lists the release's files under
# `files:`. Both are read: `path` is what an older electron-updater uses, and
# `files` is what a current one walks to pick the right artifact for the
# machine. A name in one and not the other would otherwise be the file that is
# missing from the mirror.
files_in_yml() {
  python3 -c '
import re, sys

text = sys.stdin.read()
extensions = tuple(sys.argv[1:])
names = []

# Deliberately not a YAML parser. This runs on a box where adding a dependency
# means remembering to install it, the shape is fixed by electron-builder, and
# a wrong answer here is caught by the sha512 check rather than shipped.
for match in re.finditer(r"^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$", text, re.M):
    name = match.group(1).strip().strip("\"\x27")
    if name.endswith(extensions) and name not in names:
        names.append(name)

print("\n".join(names))
'  "$@"
}

# The sha512 the yml gives for one file, base64 as electron-builder writes it.
sha512_in_yml() {
  python3 -c '
import re, sys

text = sys.stdin.read()
wanted = sys.argv[1]

# Inside `files:`, url and sha512 belong to the same list entry. The top-level
# `path`/`sha512` pair is the same values repeated, so either match is right.
for block in re.split(r"\n(?=\s*-\s)", text):
    if re.search(r"^\s*(?:-\s*)?(?:url|path):\s*[\"\x27]?" + re.escape(wanted), block, re.M):
        found = re.search(r"^\s*sha512:\s*(\S+)\s*$", block, re.M)
        if found:
            print(found.group(1).strip().strip("\"\x27"))
            break
' "$1"
}

sha512_of_file() {
  # base64 of the raw digest, which is the form electron-builder writes.
  openssl dgst -sha512 -binary "$1" | openssl base64 -A
}

download() {
  local url="$1" dest="$2"

  curl -sfL --max-time 900 --retry 3 --retry-delay 5 \
    -H "User-Agent: gryt-update-feed" \
    -o "$dest" "$url"
}

# Mirror one channel. Returns non-zero if the channel was left as it was for a
# reason worth a failed unit.
refresh_channel() {
  local channel="$1"
  local tag version state mirrored dest staging free_gb
  local yml url name expected actual
  local -a wanted=()
  local got_any=0

  if ! read -r tag version < <(newest_release "$channel"); then
    log "[$channel] cannot read releases from GitHub — leaving the mirror alone"
    return 1
  fi

  if [[ -z "${tag:-}" ]]; then
    log "[$channel] no release matches this channel"
    return 1
  fi

  state="${STATE_DIR}/${channel}.tag"
  mirrored=$(cat "$state" 2>/dev/null || echo none)

  if [[ "$mirrored" == "$tag" ]]; then
    log "[$channel] already mirroring $tag"
    return 0
  fi

  dest="${UPDATE_DIR}/${channel}"
  staging="${dest}.staging"

  free_gb=$(df -BG --output=avail "$UPDATE_DIR" 2>/dev/null | tail -1 | tr -dc '0-9')
  if [[ -n "$free_gb" ]] && (( free_gb < MIN_FREE_GB )); then
    log "[$channel] only ${free_gb}G free, want ${MIN_FREE_GB}G — refusing to download"
    return 1
  fi

  rm -rf "$staging"
  mkdir -p "$staging"

  # Downloaded into a staging directory and swapped at the end, so nothing ever
  # serves a half-mirrored release. A client that reads a yml naming a file
  # still arriving gets a 404 and falls back to a full download, which is the
  # failure this whole script exists to remove.
  for yml in "${YML_NAMES[@]}"; do
    url="https://github.com/${REPO}/releases/download/${tag}/${yml}"

    if ! download "$url" "${staging}/${yml}"; then
      # Not every release has every platform. A missing yml is a platform that
      # did not publish, and the other two are still worth serving.
      rm -f "${staging}/${yml}"
      log "[$channel] $tag has no $yml"
      continue
    fi

    got_any=1

    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      wanted+=("$name")
    done < <(files_in_yml "${INSTALLER_EXTENSIONS[@]}" < "${staging}/${yml}")
  done

  if (( ! got_any )); then
    log "[$channel] $tag has published no channel files yet — leaving the mirror alone"
    rm -rf "$staging"
    return 1
  fi

  for name in $(printf '%s\n' "${wanted[@]}" | sort -u); do
    url="https://github.com/${REPO}/releases/download/${tag}/${name}"

    if ! download "$url" "${staging}/${name}"; then
      log "[$channel] $tag is missing $name — leaving the mirror alone"
      rm -rf "$staging"
      return 1
    fi

    # The mirror's whole job is to be byte-identical, and a truncated file here
    # would be worse than the host this replaces: electron-updater checks the
    # digest only after downloading the whole thing.
    expected=""
    for yml in "${YML_NAMES[@]}"; do
      [[ -f "${staging}/${yml}" ]] || continue
      expected=$(sha512_in_yml "$name" < "${staging}/${yml}")
      [[ -n "$expected" ]] && break
    done

    if [[ -z "$expected" ]]; then
      log "[$channel] no sha512 for $name in any channel file — leaving the mirror alone"
      rm -rf "$staging"
      return 1
    fi

    actual=$(sha512_of_file "${staging}/${name}")
    if [[ "$actual" != "$expected" ]]; then
      log "[$channel] $name does not match the sha512 in the channel file — leaving the mirror alone"
      rm -rf "$staging"
      return 1
    fi

    # Best effort: not every artifact has one, and a differential download only
    # needs the blockmaps for the versions it is moving between.
    if ! download "${url}.blockmap" "${staging}/${name}.blockmap"; then
      rm -f "${staging}/${name}.blockmap"
      log "[$channel] $tag has no blockmap for $name"
    fi
  done

  carry_previous_blockmaps "$dest" "$staging"

  # Swapped rather than written in place. `mv` within one filesystem is atomic
  # per name, so the window where a client could read a new yml beside an old
  # installer is the two moves below rather than the length of a download.
  if [[ -d "$dest" ]]; then
    rm -rf "${dest}.previous"
    mv "$dest" "${dest}.previous"
  fi

  mv "$staging" "$dest"
  rm -rf "${dest}.previous"

  mkdir -p "$STATE_DIR"
  printf '%s\n' "$tag" > "$state"

  log "[$channel] mirroring $tag ($(du -sh "$dest" | cut -f1))"
}

# Keep the blockmaps of the release being replaced, and nothing else of it.
#
# See the note at the top: a cold updater cache sends electron-updater to the
# *old* version's blockmap URL, and a 404 there costs a full download with
# nothing logged. Only one release back, because that is the hop a differential
# download actually makes.
carry_previous_blockmaps() {
  local dest="$1" staging="$2" path name kept=0

  [[ -d "$dest" ]] || return 0

  for path in "$dest"/*.blockmap; do
    [[ -e "$path" ]] || continue

    name=$(basename "$path")

    # Already in the new release, so this is the same file rather than the
    # previous one.
    [[ -e "${staging}/${name}" ]] && continue

    cp -p "$path" "${staging}/${name}"
    kept=$(( kept + 1 ))
  done

  (( kept )) && log "  kept $kept blockmap(s) from the release being replaced"

  return 0
}

mkdir -p "$UPDATE_DIR"

status=0
for channel in $CHANNELS; do
  refresh_channel "$channel" || status=1
done

exit "$status"
