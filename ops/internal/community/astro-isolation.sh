#!/bin/bash
# Network isolation for the gryt-community VM (192.168.122.0/24, virbr0). It runs
# the public Gryt server, so it may reach the internet and nothing else here.

# Here rather than in LIBVIRT_FWO, where libvirt would put them: FORWARD on this
# host has blanket ACCEPT rules above the LIBVIRT_* jumps, so those are never reached.

# Unraid runs from RAM, so this is called from /boot/config/go and re-asserted by
# cron — a Docker restart rewrites the top of FORWARD and says nothing.

# Every rule is scoped to 192.168.122.0/24 as source or destination. Verify from
# inside the VM with nftables flushed: `ping 192.168.50.168` fails, ghcr.io answers.

GUEST_NET=192.168.122.0/24
GATEWAY=192.168.122.1
LAN=192.168.50.0/24

add() {  # idempotent: only insert if an identical rule is not already there
  local chain=$1; shift
  iptables -C "$chain" "$@" 2>/dev/null || iptables -I "$chain" 1 "$@"
}

# ── FORWARD: the VM must not route to any private network ───────────────────
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16; do
  add FORWARD -s "$GUEST_NET" -d "$net" -j DROP
done
# Nothing on the LAN has any business opening a connection to it either.
add FORWARD -s "$LAN" -d "$GUEST_NET" -m conntrack --ctstate NEW -j DROP

# ── INPUT: guest to Astro itself is INPUT, not FORWARD ──────────────────────
# Inserted in reverse, so the final order reads: established replies, the two
# services the gateway legitimately answers, then drop everything else.
add INPUT -s "$GUEST_NET" -j DROP
add INPUT -s "$GUEST_NET" -d "$GATEWAY" -p tcp --dport 53 -j ACCEPT
add INPUT -s "$GUEST_NET" -d "$GATEWAY" -p udp --dport 53 -j ACCEPT
add INPUT -s "$GUEST_NET" -d "$GATEWAY" -p udp --dport 67 -j ACCEPT
# Without this the reply half of every host-initiated connection is dropped,
# which takes SSH from Astro into the VM with it.
add INPUT -s "$GUEST_NET" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
