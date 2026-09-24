#!/usr/bin/env bash
# Idle memory, then the S3 matrix and LOAD_SECONDS of 50 MB uploads under `docker stats`.
# Usage: measure.sh <container> <endpoint> <access key> <secret key> [region]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
container="$1" endpoint="$2" key="$3" secret="$4" region="${5:-auto}"
mem() { docker stats --no-stream --format '{{.MemUsage}}' "$container" | awk '{print $1}'; }

until curl -s -o /dev/null "$endpoint"; do sleep 1; done
sleep "${IDLE_WAIT:-30}"
echo "idle: $(mem)"

samples="$(mktemp)"
docker stats --format '{{.MemUsage}}' "$container" >"$samples" &
sampler=$!
set +e
S3_ENDPOINT="$endpoint" S3_ACCESS_KEY_ID="$key" S3_SECRET_ACCESS_KEY="$secret" S3_REGION="$region" \
  S3_BUCKET="${S3_BUCKET:-gryt-eval}" LOAD_SECONDS="${LOAD_SECONDS:-20}" node "$here/s3-matrix.cjs"
status=$?
set -e
kill "$sampler"; wait "$sampler" 2>/dev/null || true
echo "right after: $(mem)"
# Normalise KiB/MiB/GiB to MiB and take the largest.
# The streamed output carries terminal escapes; pull the used figure off each frame.
echo "peak during matrix: $(grep -oE '[0-9.]+[KMG]iB /' "$samples" | awk '/GiB/{v=$1*1024} /MiB/{v=$1+0} /KiB/{v=$1/1024} {if (v>m) m=v} END {printf "%.0fMiB (%d samples)", m, NR}')"
rm -f "$samples"
exit "$status"
