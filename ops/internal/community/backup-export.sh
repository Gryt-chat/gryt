#!/usr/bin/env bash
# The newest nightly snapshot as a tar on stdout, for Unraid to pull (GRYT-798). It is the
# only thing Unraid's key may run: the VM is in the DMZ and never reaches into the LAN itself.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/gryt-community}"
newest="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)"
[[ -n "$newest" ]] || { echo "no backups in $BACKUP_DIR" >&2; exit 1; }
tar -C "$BACKUP_DIR" -cf - "$newest"
