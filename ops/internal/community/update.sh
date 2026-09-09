#!/usr/bin/env bash
# Keep community.gryt.chat on the images the last release published. The VM was
# found on server 1.8.3 while 1.8.7 was out, because .env pinned exact tags.

# So the versions are `latest` now and this pulls them. The trade is the one
# refresh-web-client.sh made: leaving a public server behind is also a decision.

# To pin again, put a version back in .env and `up -d` — this only ever pulls the
# tag a service is already configured for. Run from the systemd timer beside it.

set -euo pipefail

DIR="${GRYT_COMMUNITY_DIR:-/opt/gryt-community}"
SERVICES="${GRYT_COMMUNITY_SERVICES:-server sfu image-worker}"
MIN_FREE_GB="${GRYT_MIN_FREE_GB:-3}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }

cd "$DIR"

free_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
if (( free_gb < MIN_FREE_GB )); then
  log "only ${free_gb}G free, need ${MIN_FREE_GB}G — not pulling"
  exit 0
fi

for service in $SERVICES; do
  container="gryt-community-${service}"

  before=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true)
  if [[ -z "$before" ]]; then
    log "[$service] no container named $container — skipped"
    continue
  fi

  # Recreating the SFU drops every call on it, so leave it alone while anybody is
  # connected. Voice is not expected on this server, but "not expected" is not "never".
  if [[ "$service" == "sfu" ]]; then
    peers=$(curl -sf --max-time 5 http://127.0.0.1:5025/metrics 2>/dev/null \
      | awk '/^gryt_sfu_peers_active /{print $2}' || true)
    if [[ -n "$peers" && "$peers" != "0" ]]; then
      log "[$service] $peers in voice — leaving it, will try again next tick"
      continue
    fi
  fi

  if ! docker compose pull "$service" >/dev/null 2>&1; then
    log "[$service] pull failed — leaving the running container alone"
    continue
  fi

  # Compare like with like: `before` is the image the container was created from,
  # so `after` has to be what that container's own tag resolves to, read the same way.

  # `docker compose images -q` answers in a different id format, so it never matched
  # and every service was recreated on every tick.
  ref=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)
  after=$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null || true)
  if [[ -z "$after" || "$before" == "$after" ]]; then
    log "[$service] already on ${ref:-?}"
    continue
  fi

  docker compose up -d --no-deps "$service" >/dev/null 2>&1
  log "[$service] recreated on $ref (${before:7:12} -> ${after:7:12})"
done
