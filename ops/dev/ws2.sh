#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/ops/dev/common.env.sh"

cd "${ROOT_DIR}/packages/server"

# Build env for optional deps
if [[ "${DEV_WITH_DB:-1}" == "1" ]]; then
  # Each server instance should use its own keyspace (DB isolation).
  export SCYLLA_KEYSPACE="${SCYLLA_KEYSPACE_WS2:-ws2}"
  export SCYLLA_CONTACT_POINTS SCYLLA_LOCAL_DATACENTER SCYLLA_KEYSPACE
else
  export DISABLE_SCYLLA=true
fi

if [[ "${DEV_WITH_S3:-1}" == "1" ]]; then
  export S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET S3_FORCE_PATH_STYLE
else
  export DISABLE_S3=true
fi

export PORT=5001
export SERVER_NAME=ws2
export SERVER_PASSWORD="${SERVER_PASSWORD-changeme}"
export CORS_ORIGIN SFU_WS_HOST SFU_PUBLIC_HOST STUN_SERVERS
export GRYT_AUTH_MODE GRYT_OIDC_ISSUER GRYT_OIDC_AUDIENCE
export JWT_SECRET

yarn dev

