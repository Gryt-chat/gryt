#!/usr/bin/env bash
# Posts to Discord when a Gryt WireGuard peer on the VPS goes quiet, and again when it's back.
# Runs every minute from gryt-tunnel-alert.timer. See README.md.

set -u

IFACE="${TUNNEL_ALERT_IFACE:-wg0}"
WG="${TUNNEL_ALERT_WG:-wg}"
STATE_DIR="${TUNNEL_ALERT_STATE:-/var/lib/gryt-tunnel-alert}"
ENV_FILE="${TUNNEL_ALERT_ENV:-/etc/gryt-tunnel-alert.env}"
NOW="${TUNNEL_ALERT_NOW:-$(date +%s)}"

# Keepalive is 25s and a live peer rekeys every ~2 minutes, so 5 minutes is down.
STALE=300

# Only Gryt's peers. The others on wg0 aren't ours to alert on.
declare -A PEERS=(
    ["10.2.0.5"]="dev box (prod and beta voice)"
    ["10.2.0.6"]="community VM"
)

log() { echo "[$(date -Is)] $*"; }

webhook_url() {
    [[ -r "$ENV_FILE" ]] || return 1
    grep -E '^TUNNEL_ALERT_WEBHOOK_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"
}

# The URL goes to curl on stdin, so it never shows up in ps or the journal.
post() {
    local text="$1" url code
    url="$(webhook_url)"
    if [[ -z "$url" ]]; then
        log "no TUNNEL_ALERT_WEBHOOK_URL in $ENV_FILE; not posted: $text"
        return 1
    fi
    code=$(printf 'url = "%s"\n' "$url" | curl -s -o /dev/null -w '%{http_code}' -m 10 -K - \
        -H 'Content-Type: application/json' \
        --data "{\"content\":\"$text\",\"allowed_mentions\":{\"parse\":[]}}")
    log "posted (HTTP $code): $text"
    [[ "$code" == 2* ]]
}

human() {
    local s="$1"
    if (( s >= 86400 )); then echo "$((s / 86400))d $((s % 86400 / 3600))h"
    elif (( s >= 3600 )); then echo "$((s / 3600))h $((s % 3600 / 60))m"
    elif (( s >= 60 )); then echo "$((s / 60))m"
    else echo "${s}s"; fi
}

if [[ "${1:-}" == "--test" ]]; then
    post "Test from gryt-tunnel-alert on $(hostname). Nothing is down." && exit 0
    exit 1
fi

mkdir -p "$STATE_DIR"

# Missing interface or a failed `wg` leaves this empty, and every peer reads as missing.
dump="$("$WG" show "$IFACE" dump 2>/dev/null | tail -n +2)"

for ip in "${!PEERS[@]}"; do
    name="${PEERS[$ip]}"
    state="$STATE_DIR/$ip"
    handshake=""

    while IFS=$'\t' read -r _pub _psk _endpoint allowed hs _rest; do
        [[ ",$allowed," == *",$ip/32,"* ]] && handshake="$hs"
    done <<< "$dump"

    # State file: "<down since> <alerted 0|1>". No file means healthy.
    since=""
    alerted=0
    [[ -f "$state" ]] && read -r since alerted < "$state"

    if [[ -n "$handshake" && "$handshake" != 0 ]] && (( NOW - handshake < STALE )); then
        if [[ "$alerted" == 1 ]]; then
            post "Tunnel back: $name ($ip) has a WireGuard handshake again after $(human $((NOW - since))) down." \
                && rm -f "$state"
        else
            rm -f "$state"
        fi
        continue
    fi

    # A stale peer has been down since its last handshake; one with none, since we first noticed.
    if [[ -n "$handshake" && "$handshake" != 0 ]]; then
        since="$handshake"
        reason="no WireGuard handshake for $(human $((NOW - handshake)))"
    else
        since="${since:-$NOW}"
        if [[ -z "$handshake" ]]; then reason="peer not on $IFACE"; else reason="no handshake since wg started"; fi
    fi

    if [[ "$alerted" != 1 ]] && (( NOW - since >= STALE )); then
        post "Tunnel down: $name ($ip), $reason." && alerted=1
    fi
    echo "$since $alerted" > "$state"
    log "$ip down since $since ($reason), alerted=$alerted"
done
