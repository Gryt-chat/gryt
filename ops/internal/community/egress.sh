#!/usr/bin/env bash

# Containers reach the internet through the VPS; the VM's own traffic, cloudflared
# included, goes direct. Safe to re-run: the timer calls `up` every minute.
set -euo pipefail

CONTAINERS="172.16.0.0/12"
TABLE=51820
NFT_TABLE=gryt_egress

usage() {
  echo "usage: egress.sh up|down|check" >&2
  exit 2
}

uplink() {
  ip -4 route show default table main | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
}

# Loaded before the routes, so a container can't leave through the house connection
# while wg0 or the rules are missing. It fails closed instead.
guard() {
  local dev
  dev="$(uplink)"
  dev="${dev:-enp1s0}"
  nft -f - <<EOF
table inet $NFT_TABLE
delete table inet $NFT_TABLE
table inet $NFT_TABLE {
  chain forward {
    type filter hook forward priority mangle; policy accept;
    oifname "wg0" tcp flags syn / syn,rst tcp option maxseg size set rt mtu
    iifname "docker0" oifname "$dev" counter drop
    iifname "br-*" oifname "$dev" counter drop
  }
}
EOF
}

has_rule() {
  [[ -n "$(ip -4 rule show priority "$1")" ]]
}

up() {
  guard
  if ! ip link show wg0 >/dev/null 2>&1; then
    echo "egress: wg0 is down, containers stay offline until it is back" >&2
    exit 1
  fi
  ip -4 route replace default dev wg0 table "$TABLE"
  # Main without its default route first, so replies to the bridge and to cloudflared stay local.
  has_rule 9000 || ip -4 rule add priority 9000 from "$CONTAINERS" lookup main suppress_prefixlength 0
  has_rule 9001 || ip -4 rule add priority 9001 from "$CONTAINERS" lookup "$TABLE"
}

down() {
  while has_rule 9001; do ip -4 rule del priority 9001; done
  while has_rule 9000; do ip -4 rule del priority 9000; done
  ip -4 route flush table "$TABLE" 2>/dev/null || true
}

check() {
  local ok=0
  has_rule 9000 || { echo "missing: rule 9000"; ok=1; }
  has_rule 9001 || { echo "missing: rule 9001"; ok=1; }
  ip -4 route show table "$TABLE" | grep -q "default dev wg0" || { echo "missing: default via wg0 in table $TABLE"; ok=1; }
  nft list table inet "$NFT_TABLE" >/dev/null 2>&1 || { echo "missing: nft table $NFT_TABLE"; ok=1; }
  [[ $ok -eq 0 ]] && echo "egress: ok"
  return $ok
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  check) check ;;
  *) usage ;;
esac
