#!/usr/bin/env bash
# Voice media is UDP through WireGuard, which no HTTP check can see. This pushes
# each Gryt tunnel's handshake health to Gatus; stop pushing and its heartbeat fails.

set -u

DEST="${CONSOLE_DEST:-/opt/gryt-status}"
GATUS="http://127.0.0.1:3001"

# A live peer rekeys every ~2 minutes under keepalive 25, so 5 minutes is dead.
STALE=300

# Peer address -> Gatus key. Only Gryt's own tunnels: the game server is not ours to report.
declare -A TUNNELS=(
    ["10.2.0.5/32"]="talking_voice-calls"
    ["10.2.0.6/32"]="talking_community-voice-calls"
)

TOKEN="$(grep -E '^VOICE_TUNNEL_TOKEN=' "$DEST/.env" 2>/dev/null | cut -d= -f2-)"
if [[ -z "$TOKEN" ]]; then
    echo "[$(date -Is)] VOICE_TUNNEL_TOKEN missing from $DEST/.env; nothing pushed"
    exit 1
fi

now=$(date +%s)
declare -A seen=()

# `wg show dump` is tab-separated; line one is the interface, the rest are peers.
while IFS=$'\t' read -r _pub _psk _endpoint allowed handshake _rx _tx _ka; do
    for ip in "${!TUNNELS[@]}"; do
        [[ ",$allowed," == *",$ip,"* ]] || continue
        seen[$ip]=1
        age=$(( now - handshake ))

        if (( handshake > 0 && age < STALE )); then
            query="success=true"
        else
            query="success=false&error=no%20WireGuard%20handshake%20for%20${age}s"
        fi

        code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
            -H "Authorization: Bearer $TOKEN" "$GATUS/api/v1/endpoints/${TUNNELS[$ip]}/external?$query")
        echo "[$(date -Is)] ${TUNNELS[$ip]} age=${age}s -> $query (gatus $code)"
    done
done < <(wg show wg0 dump 2>/dev/null | tail -n +2)

# A peer missing from wg entirely is as dead as a stale one, and must say so.
for ip in "${!TUNNELS[@]}"; do
    [[ -n "${seen[$ip]:-}" ]] && continue
    curl -s -o /dev/null -m 10 -X POST -H "Authorization: Bearer $TOKEN" \
        "$GATUS/api/v1/endpoints/${TUNNELS[$ip]}/external?success=false&error=peer%20not%20configured%20on%20wg0"
    echo "[$(date -Is)] ${TUNNELS[$ip]} -> not on wg0"
done
