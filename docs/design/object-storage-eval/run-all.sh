#!/usr/bin/env bash
# Fresh volume per candidate, then measure.sh. Everything is named gryt-eval-*.
# Usage: SERVER_DIR=<packages/server checkout> ./run-all.sh [minio garage seaweedfs rustfs]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
garage_key=GK0123456789abcdef01234567
garage_secret=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

for n in ${@:-minio garage seaweedfs rustfs}; do
  {
    echo "=== $n"
    docker compose -f "compose/$n.yml" down -v >/dev/null 2>&1
    docker compose -f "compose/$n.yml" up -d --wait >/dev/null 2>&1 || docker compose -f "compose/$n.yml" up -d >/dev/null 2>&1
    case "$n" in
      minio)     ./measure.sh gryt-eval-minio http://127.0.0.1:19100 evaladmin evalsecret-evalsecret ;;
      # Garage sends a composite checksum the SDK cannot tell apart from a whole-object one.
      garage)    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required ./measure.sh gryt-eval-garage http://127.0.0.1:19200 "$garage_key" "$garage_secret" ;;
      seaweedfs) ./measure.sh gryt-eval-seaweedfs http://127.0.0.1:19300 evaladmin evalsecret-evalsecret ;;
      rustfs)    ./measure.sh gryt-eval-rustfs http://127.0.0.1:19400 evaladmin evalsecret-evalsecret ;;
    esac 2>&1 | grep -v '^PASS'
  }
done
