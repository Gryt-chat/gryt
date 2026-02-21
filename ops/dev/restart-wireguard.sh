#!/usr/bin/env bash
set -euo pipefail

CONFIG="/etc/wireguard/wg0.conf"

if [ ! -f "$CONFIG" ]; then
  echo "Error: $CONFIG not found"
  exit 1
fi

echo "Restarting WireGuard using $CONFIG"
sudo wg-quick down "$CONFIG" 2>/dev/null || echo "Interface was not up, skipping down."
sudo wg-quick up "$CONFIG"
echo "WireGuard is back up."
