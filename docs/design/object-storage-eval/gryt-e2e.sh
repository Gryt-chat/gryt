#!/usr/bin/env bash
# The real server and image worker from source, against one store.
# Usage: SERVER_DIR=... WORKER_DIR=... gryt-e2e.sh <endpoint> <access key> <secret key> [bucket]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
endpoint="$1" key="$2" secret="$3" bucket="${4-gryt}"
work="$(mktemp -d)"; mkdir -p "$work/data"
port="${GRYT_PORT:-5013}"

# Media: a noisy PNG sharp cannot shrink to nothing, and a ~50 MB H.264 clip.
ffmpeg -loglevel error -f lavfi -i "nullsrc=s=2400x1600,geq=random(1)*255:128:128" -frames:v 1 "$work/eval.png"
ffmpeg -loglevel error -f lavfi -i "testsrc2=size=1920x1080:rate=30" -t 20 -c:v libx264 -b:v 20M -pix_fmt yuv420p "$work/eval.mp4"

export DATA_DIR="$work/data" JWT_SECRET=gryt-eval-secret S3_ENDPOINT="$endpoint" S3_REGION=auto \
  S3_ACCESS_KEY_ID="$key" S3_SECRET_ACCESS_KEY="$secret" S3_BUCKET="$bucket" S3_FORCE_PATH_STYLE=true
(cd "$SERVER_DIR" && PORT="$port" HOST=127.0.0.1 GRYT_IDENTITY_TIERS=local exec node -r ts-node/register src/index.ts) >"$work/server.log" 2>&1 &
server=$!
trap 'kill $server ${worker:-} 2>/dev/null; wait 2>/dev/null; echo "logs kept in $work"' EXIT
until curl -s -o /dev/null "http://127.0.0.1:$port/info"; do
  kill -0 $server 2>/dev/null || { tail -30 "$work/server.log"; exit 1; }
  sleep 1
done
(cd "$WORKER_DIR" && HEALTH_PORT=18099 exec node -r ts-node/register src/index.ts) >"$work/worker.log" 2>&1 &
worker=$!

cd "$SERVER_DIR"
GRYT_URL="http://127.0.0.1:$port" E2E_IMAGE="$work/eval.png" E2E_VIDEO="$work/eval.mp4" \
  node -r ts-node/register "$here/gryt-e2e.cjs"
