#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/dev/common.env.sh"

wait_for_tcp() {
  local host="$1" port="$2" name="$3" seconds="${4:-60}"
  echo "Waiting for ${name} on ${host}:${port}..."
  for _ in $(seq 1 "$seconds"); do
    if (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1; then
      echo "${name} is up."
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${name} on ${host}:${port}" >&2
  return 1
}

wait_for_http_ready() {
  local url="$1" name="$2" seconds="${3:-60}"
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  echo "Waiting for ${name} ready endpoint..."
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "${name} is ready."
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${name} at ${url}" >&2
  return 1
}

if [[ "$DEV_WITH_DB" != "1" && "$DEV_WITH_S3" != "1" ]]; then
  echo "DEV_WITH_DB=0 and DEV_WITH_S3=0: skipping deps."
  exit 0
fi

cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start dev dependencies. Install Docker or set DEV_WITH_DB=0 DEV_WITH_S3=0." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker or set DEV_WITH_DB=0 DEV_WITH_S3=0." >&2
  exit 1
fi

docker compose -f deploy/compose/dev-deps.yml up -d

if [[ "$DEV_WITH_DB" == "1" ]]; then
  wait_for_tcp 127.0.0.1 9042 "ScyllaDB" 90
fi

if [[ "$DEV_WITH_S3" == "1" ]]; then
  wait_for_tcp 127.0.0.1 9000 "MinIO" 60
  wait_for_http_ready "http://127.0.0.1:9000/minio/health/ready" "MinIO" 60 || true
  docker compose -f deploy/compose/dev-deps.yml up -d minio-init >/dev/null 2>&1 || true
fi

echo "Dev deps started."

