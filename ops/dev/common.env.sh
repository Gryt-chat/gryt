#!/usr/bin/env bash
set -euo pipefail

# Shared dev defaults for running components in separate terminals.

export DEV_WITH_DB="${DEV_WITH_DB:-1}"

# Uploads go to a folder under each server's DATA_DIR. No object store to start.
export S3_BUCKET="${S3_BUCKET:-gryt}"

# Local defaults for SFU + STUN in dev
export SFU_WS_HOST="${SFU_WS_HOST:-ws://127.0.0.1:9092}"
export SFU_PUBLIC_HOST="${SFU_PUBLIC_HOST:-wss://sfu.example.com}"
export STUN_SERVERS="${STUN_SERVERS:-stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302}"

# CORS allowlist (http://127.0.0.1:15738 = Electron desktop app)
export CORS_ORIGIN="${CORS_ORIGIN:-http://127.0.0.1:15738,http://localhost:3777,https://app.gryt.chat}"

# Gryt auth (Keycloak / OIDC)
export GRYT_AUTH_MODE="${GRYT_AUTH_MODE:-required}"
export GRYT_OIDC_ISSUER="${GRYT_OIDC_ISSUER:-https://auth.gryt.chat/realms/gryt}"
export GRYT_OIDC_AUDIENCE="${GRYT_OIDC_AUDIENCE:-gryt-web}"

# JWT secret for signing access tokens (dev default only — never use this in production)
export JWT_SECRET="${JWT_SECRET:-dev-secret-do-not-use-in-production}"

