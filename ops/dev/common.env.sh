#!/usr/bin/env bash
set -euo pipefail

# Shared dev defaults for running components in separate terminals.

# Dev defaults: run with local Scylla + MinIO (full feature set)
export DEV_WITH_DB="${DEV_WITH_DB:-1}"
export DEV_WITH_S3="${DEV_WITH_S3:-1}"

# Local dev dependency config (only used when DEV_WITH_DB/DEV_WITH_S3 enabled)
export SCYLLA_CONTACT_POINTS="${SCYLLA_CONTACT_POINTS:-127.0.0.1}"
export SCYLLA_LOCAL_DATACENTER="${SCYLLA_LOCAL_DATACENTER:-datacenter1}"
# Default keyspace for single-server workflows.
export SCYLLA_KEYSPACE="${SCYLLA_KEYSPACE:-gryt_dev}"
# Per-server keyspaces (DB isolation). `ws1.sh`/`ws2.sh` override SCYLLA_KEYSPACE using these.
export SCYLLA_KEYSPACE_WS1="${SCYLLA_KEYSPACE_WS1:-ws1}"
export SCYLLA_KEYSPACE_WS2="${SCYLLA_KEYSPACE_WS2:-ws2}"

export MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
export MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
export S3_BUCKET="${S3_BUCKET:-gryt}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-$MINIO_ROOT_USER}"
export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-$MINIO_ROOT_PASSWORD}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

# Local defaults for SFU + STUN in dev
export SFU_WS_HOST="${SFU_WS_HOST:-ws://127.0.0.1:5005}"
export SFU_PUBLIC_HOST="${SFU_PUBLIC_HOST:-wss://sfu.example.com}"
export STUN_SERVERS="${STUN_SERVERS:-stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302}"

# CORS allowlist (http://127.0.0.1:15738 = Electron desktop app)
export CORS_ORIGIN="${CORS_ORIGIN:-http://127.0.0.1:15738,http://localhost:3777,https://app.gryt.chat}"

# Gryt auth (Keycloak / OIDC)
export GRYT_AUTH_MODE="${GRYT_AUTH_MODE:-required}"
export GRYT_OIDC_ISSUER="${GRYT_OIDC_ISSUER:-https://auth.gryt.chat/realms/gryt}"
export GRYT_OIDC_AUDIENCE="${GRYT_OIDC_AUDIENCE:-gryt-web}"

# JWT secret for signing access tokens (dev default only — never use this in production)
export JWT_SECRET="${JWT_SECRET:-dev-secret-do-not-use-in-production}"

