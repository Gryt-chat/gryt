#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/ops/dev/common.env.sh"

cd "${ROOT_DIR}/packages/server"

export S3_BUCKET

export PORT=5000
export SERVER_NAME=ws1
export SERVER_PASSWORD="${SERVER_PASSWORD-changeme}"
export CORS_ORIGIN SFU_WS_HOST SFU_PUBLIC_HOST STUN_SERVERS
export GRYT_AUTH_MODE GRYT_OIDC_ISSUER GRYT_OIDC_AUDIENCE
export JWT_SECRET

yarn dev

