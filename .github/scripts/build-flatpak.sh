#!/usr/bin/env bash
# Usage: build-flatpak.sh <deb> <version> <out.flatpak>. Needs flatpak-builder and
# the flathub remote; release-flatpak.yml runs it in Flathub's own build image.
set -euo pipefail

DEB="$(realpath "$1")"
VERSION="$2"
OUT="$(realpath -m "$3")"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$HERE"/packaging/flatpak/chat.gryt.Gryt.* "$WORK/"
cp "$DEB" "$WORK/gryt-chat.deb"

# The <release> in the metainfo is a placeholder. appstreamcli wants the date and
# a timestamp, and the date is UTC to match the changelog line.
NOW="$(date -u +%s)"
TODAY="$(date -u -d "@$NOW" +%F)"
sed -i -E \
  "s|<release version=\"[^\"]*\" date=\"[^\"]*\" timestamp=\"[^\"]*\">|<release version=\"${VERSION}\" date=\"${TODAY}\" timestamp=\"${NOW}\">|" \
  "$WORK/chat.gryt.Gryt.metainfo.xml"
grep -q "<release version=\"${VERSION}\"" "$WORK/chat.gryt.Gryt.metainfo.xml"

# --system in CI, where the build image already has the runtime installed there.
SCOPE="${FLATPAK_SCOPE:---user}"
flatpak remote-add "$SCOPE" --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# rofiles-fuse needs /dev/fuse, which a container does not have.
cd "$WORK"
flatpak-builder \
  "$SCOPE" \
  --install-deps-from=flathub \
  --disable-rofiles-fuse \
  --force-clean \
  --default-branch=stable \
  --repo=repo \
  builddir chat.gryt.Gryt.yml

# --runtime-repo lets `flatpak install` fetch the runtime from Flathub on a machine
# that has never added it.
mkdir -p "$(dirname "$OUT")"
flatpak build-bundle \
  --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  repo "$OUT" chat.gryt.Gryt stable

ls -la "$OUT"
