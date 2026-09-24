#!/usr/bin/env bash
# Usage: build-flatpak.sh <deb> <version> <out.flatpak> <appid>. <appid> is chat.gryt.Gryt
# for the slim build or chat.gryt.Gryt.Full for the full one, and names the manifest and
# its sources in packaging/flatpak. Needs flatpak-builder and the flathub remote;
# release-flatpak.yml runs it in Flathub's own build image.
set -euo pipefail

DEB="$(realpath "$1")"
VERSION="$2"
OUT="$(realpath -m "$3")"
APPID="$4"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Named explicitly rather than a glob: chat.gryt.Gryt.* also matches
# chat.gryt.Gryt.Full.*, which would pull the other variant's files in too.
cp "$HERE/packaging/flatpak/$APPID.yml" "$WORK/"
cp "$HERE/packaging/flatpak/$APPID.sh" "$WORK/"
cp "$HERE/packaging/flatpak/$APPID.desktop" "$WORK/"
cp "$HERE/packaging/flatpak/$APPID.metainfo.xml" "$WORK/"
cp "$DEB" "$WORK/gryt-chat.deb"

# The <release> in the metainfo is a placeholder. appstreamcli wants the date and
# a timestamp, and the date is UTC to match the changelog line.
NOW="$(date -u +%s)"
TODAY="$(date -u -d "@$NOW" +%F)"
sed -i -E \
  "s|<release version=\"[^\"]*\" date=\"[^\"]*\" timestamp=\"[^\"]*\">|<release version=\"${VERSION}\" date=\"${TODAY}\" timestamp=\"${NOW}\">|" \
  "$WORK/$APPID.metainfo.xml"
grep -q "<release version=\"${VERSION}\"" "$WORK/$APPID.metainfo.xml"

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
  builddir "$APPID.yml"

# --runtime-repo lets `flatpak install` fetch the runtime from Flathub on a machine
# that has never added it.
mkdir -p "$(dirname "$OUT")"
flatpak build-bundle \
  --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  repo "$OUT" "$APPID" stable

ls -la "$OUT"
