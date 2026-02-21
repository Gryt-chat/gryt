#!/bin/bash
set -euo pipefail

SESSION="gryt"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Load local overrides (ops/.env) ───────────────────────────────────
ENV_FILE="${SCRIPT_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

DEV_WITH_DB="${DEV_WITH_DB:-1}"
DEV_WITH_S3="${DEV_WITH_S3:-1}"

# ── Dev dependency config ────────────────────────────────────────────
SCYLLA_KEYSPACE_WS1="${SCYLLA_KEYSPACE_WS1:-ws1}"
SCYLLA_KEYSPACE_WS2="${SCYLLA_KEYSPACE_WS2:-ws2}"
SCYLLA_ENV_WS1="SCYLLA_CONTACT_POINTS=127.0.0.1 SCYLLA_LOCAL_DATACENTER=datacenter1 SCYLLA_KEYSPACE=${SCYLLA_KEYSPACE_WS1}"
SCYLLA_ENV_WS2="SCYLLA_CONTACT_POINTS=127.0.0.1 SCYLLA_LOCAL_DATACENTER=datacenter1 SCYLLA_KEYSPACE=${SCYLLA_KEYSPACE_WS2}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
S3_BUCKET="${S3_BUCKET:-gryt}"
S3_ENV="S3_ENDPOINT=http://127.0.0.1:9000 S3_REGION=us-east-1 S3_ACCESS_KEY_ID=${MINIO_ROOT_USER} S3_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD} S3_BUCKET=${S3_BUCKET} S3_FORCE_PATH_STYLE=true"

DB_DISABLE_ENV="DISABLE_SCYLLA=true"
S3_DISABLE_ENV="DISABLE_S3=true"

SFU_WS_HOST="${SFU_WS_HOST:-ws://127.0.0.1:5005}"
SFU_PUBLIC_HOST="${SFU_PUBLIC_HOST:-wss://sfu.example.com}"
STUN_SERVERS="${STUN_SERVERS:-stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302}"
CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3666,https://gryt.example.com}"
GRYT_AUTH_MODE="${GRYT_AUTH_MODE:-required}"
GRYT_OIDC_ISSUER="${GRYT_OIDC_ISSUER:-https://auth.gryt.chat/realms/gryt}"
GRYT_OIDC_AUDIENCE="${GRYT_OIDC_AUDIENCE:-gryt-web}"
JWT_SECRET="${JWT_SECRET:-dev-secret-do-not-use-in-production}"
SERVER_PASSWORD="${SERVER_PASSWORD-changeme}"
OWNER_ID="${OWNER_ID:-c49d6a91-9ee7-4fd0-99e8-2021e08618a7}"

# ── Helpers ──────────────────────────────────────────────────────────
wait_for_tcp() {
  local host="$1" port="$2" name="$3" seconds="${4:-60}"
  printf "Waiting for %s on %s:%s..." "$name" "$host" "$port"
  for _ in $(seq 1 "$seconds"); do
    if (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1; then
      echo " up."
      return 0
    fi
    sleep 1
  done
  echo " timed out." >&2
  return 1
}

wait_for_http() {
  local url="$1" name="$2" seconds="${3:-60}"
  command -v curl >/dev/null 2>&1 || return 0
  printf "Waiting for %s ready..." "$name"
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo " ready."
      return 0
    fi
    sleep 1
  done
  echo " timed out." >&2
  return 1
}

# ── Restart by default, pass --attach to reuse existing session ───────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  if [[ "${1:-}" == "--attach" ]]; then
    echo "Session '$SESSION' already running. Attaching..."
    exec tmux attach -t "$SESSION"
  else
    echo "Session '$SESSION' exists. Restarting... (use --attach to reuse)"
    tmux kill-session -t "$SESSION"
    sleep 0.5
  fi
fi

# ── Docker deps (ScyllaDB + MinIO) ──────────────────────────────────
if [[ "$DEV_WITH_DB" == "1" || "$DEV_WITH_S3" == "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required. Install Docker or set DEV_WITH_DB=0 DEV_WITH_S3=0." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon is not running." >&2
    exit 1
  fi

  echo "Starting dev dependencies (ScyllaDB + MinIO)..."
  docker compose -f ops/deploy/compose/dev-deps.yml up -d --wait 2>/dev/null \
    || docker compose -f ops/deploy/compose/dev-deps.yml up -d

  [[ "$DEV_WITH_DB" == "1" ]] && wait_for_tcp 127.0.0.1 9042 "ScyllaDB" 90
  if [[ "$DEV_WITH_S3" == "1" ]]; then
    wait_for_tcp 127.0.0.1 9000 "MinIO" 60
    wait_for_http "http://127.0.0.1:9000/minio/health/ready" "MinIO" 60 || true
    # Best-effort init (compose service) + explicit bucket ensure (so avatar/file uploads don't 502).
    docker compose -f ops/deploy/compose/dev-deps.yml up -d minio-init >/dev/null 2>&1 || true
    echo "Ensuring MinIO bucket exists: ${S3_BUCKET}"
    docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -lc "\
      mc alias set local http://127.0.0.1:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null 2>&1 \
      && mc mb -p 'local/${S3_BUCKET}' >/dev/null 2>&1 || true"
  fi
  echo ""
fi

# ── Install JS dependencies ──────────────────────────────────────────
echo "Installing JS dependencies..."
(cd packages/client && npm install --silent) &
(cd packages/server && npm install --silent) &
wait
echo ""

# ── Build env strings for servers ────────────────────────────────────
WS_DB_ENV="$DB_DISABLE_ENV"
WS_S3_ENV="$S3_DISABLE_ENV"
[[ "$DEV_WITH_DB" == "1" ]] && WS_DB_ENV=""
[[ "$DEV_WITH_S3" == "1" ]] && WS_S3_ENV="$S3_ENV"

COMMON_ENV="CORS_ORIGIN=${CORS_ORIGIN} GRYT_AUTH_MODE=${GRYT_AUTH_MODE} GRYT_OIDC_ISSUER=${GRYT_OIDC_ISSUER} GRYT_OIDC_AUDIENCE=${GRYT_OIDC_AUDIENCE} JWT_SECRET=${JWT_SECRET} SERVER_PASSWORD=${SERVER_PASSWORD} OWNER_ID=${OWNER_ID} SFU_WS_HOST=${SFU_WS_HOST} SFU_PUBLIC_HOST=${SFU_PUBLIC_HOST} STUN_SERVERS=${STUN_SERVERS} ${WS_DB_ENV} ${WS_S3_ENV}"

# ── Create tmux session with separate windows ────────────────────────
echo "Creating tmux session '$SESSION' with 5 windows..."
echo "  [0] sfu   [1] client   [2] ws1   [3] ws2   [4] shell"
echo "  Ctrl+B then 0-4 to switch, Ctrl+B w for window list."
echo ""

# Window 0: SFU
tmux new-session -d -s "$SESSION" -n sfu \
  "bash -lc 'export PATH=\"/usr/local/go/bin:\$PATH\"; cd packages/sfu && echo \"── SFU ──\" && ./start.sh; exec bash'"

# Window 1: Client (Vite)
tmux new-window -t "$SESSION" -n client \
  "bash -lc 'cd packages/client && echo \"── Client ──\" && bun dev --host; exec bash'"

# Window 2: Server 1 (ws1) on :5000
tmux new-window -t "$SESSION" -n ws1 \
  "bash -lc 'cd packages/server && echo \"── ws1 :5000 ──\" && env PORT=5000 SERVER_NAME=ws1 SERVER_ICON=owl-4.png ${COMMON_ENV} ${DEV_WITH_DB:+${SCYLLA_ENV_WS1}} bun dev; exec bash'"

# Window 3: Server 2 (ws2) on :5001
tmux new-window -t "$SESSION" -n ws2 \
  "bash -lc 'cd packages/server && echo \"── ws2 :5001 ──\" && env PORT=5001 SERVER_NAME=ws2 SERVER_ICON=owl-9.png ${COMMON_ENV} ${DEV_WITH_DB:+${SCYLLA_ENV_WS2}} bun dev; exec bash'"

# Window 4: spare shell for ad-hoc commands
tmux new-window -t "$SESSION" -n shell

# Start on the client window
tmux select-window -t "$SESSION":1

tmux attach -t "$SESSION"
