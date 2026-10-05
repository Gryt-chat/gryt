#!/bin/bash
# Runs on Unraid as a User Script, nightly after the VM's own backup (04:17 UTC plus a
# random delay of up to 30 minutes). Pulls the newest snapshot onto the parity array.
set -euo pipefail

VM="${VM:-sivert@192.168.122.213}"
KEY="${KEY:-/boot/config/gryt-backup/id_ed25519}"
DEST="${DEST:-/mnt/user/gryt-backups/community}"
KEEP_DAYS="${KEEP_DAYS:-31}"

mkdir -p "$DEST"
tmp="$(mktemp -d "$DEST/.incoming.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# The key is restricted on the VM to backup-export.sh, so whatever is asked, that runs.
# Its own known_hosts: /root/.ssh is on the flash drive, where ssh can't link its usual one.
ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  -o UserKnownHostsFile="$(dirname "$KEY")/known_hosts" "$VM" true | tar -C "$tmp" -xf -
snapshot="$(ls "$tmp")"
[[ -n "$snapshot" && -s "$tmp/$snapshot/gryt.db.gz" ]] || { echo "pulled nothing usable" >&2; exit 1; }
if [[ -e "$DEST/$snapshot" ]]; then
  echo "$snapshot already here"
else
  mv "$tmp/$snapshot" "$DEST/"
  echo "pulled $snapshot ($(du -sh "$DEST/$snapshot" | cut -f1))"
fi

find "$DEST" -mindepth 1 -maxdepth 1 -type d ! -name '.incoming.*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
