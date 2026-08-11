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
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
S3_BUCKET="${S3_BUCKET:-gryt}"
S3_ENV="S3_ENDPOINT=http://127.0.0.1:9000 S3_REGION=us-east-1 S3_ACCESS_KEY_ID=${MINIO_ROOT_USER} S3_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD} S3_BUCKET=${S3_BUCKET} S3_FORCE_PATH_STYLE=true"

S3_DISABLE_ENV="DISABLE_S3=true"

# The server hands SFU_PUBLIC_HOST straight to the client, which dials it — so
# a placeholder here isn't inert, it guarantees a failed voice connect. Default
# to this machine's LAN address so another machine can reach the SFU too;
# SFU_WS_HOST stays loopback because that hop is server-to-SFU on this box.
detect_lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  else
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}
LAN_IP="${LAN_IP:-$(detect_lan_ip || true)}"

SFU_WS_HOST="${SFU_WS_HOST:-ws://127.0.0.1:5005}"
SFU_PUBLIC_HOST="${SFU_PUBLIC_HOST:-ws://${LAN_IP:-127.0.0.1}:5005}"
STUN_SERVERS="${STUN_SERVERS:-stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302}"
# 3666 is the Vite dev server port (packages/client/vite.config.ts); the server
# matches Origin exactly, so it must be listed verbatim.
CORS_ORIGIN="${CORS_ORIGIN:-http://127.0.0.1:15738,http://localhost:3666,http://127.0.0.1:3666,https://app.gryt.chat}"
# Loopback by default so a dev server isn't exposed on whatever network you
# happen to be on. Set HOST=0.0.0.0 in ops/.env to test LAN discovery, where
# another machine has to reach ws1/ws2 over the wire.
HOST="${HOST:-127.0.0.1}"
GRYT_AUTH_MODE="${GRYT_AUTH_MODE:-required}"
GRYT_OIDC_AUDIENCE="${GRYT_OIDC_AUDIENCE:-gryt-web}"
# Which identities the dev servers admit. Add "local" to try joining with no
# account at all: GRYT_IDENTITY_TIERS=account,local ./ops/start_dev.sh
GRYT_IDENTITY_TIERS="${GRYT_IDENTITY_TIERS:-account}"

# ── Local auth ───────────────────────────────────────────────────────
#
# Dev used to authenticate against production: real Keycloak, real identity
# CA, real accounts. That made every dev session depend on prod being up, and
# left no way to make a throwaway account without making a real one.
#
# Keycloak and its Postgres run in containers because they have to. The
# identity CA runs on the host, and that is deliberate rather than
# inconsistent: it has to reach Keycloak at the same URL string that appears in
# the token's `iss` claim, and "localhost:18080" means different things on
# either side of a container boundary. In Docker that forces the issuer to be
# the machine's LAN address, which then breaks every time you change network.
# On the host it is plain localhost and the problem does not exist.
#
# Set DEV_WITH_AUTH=0 in ops/.env to go back to production auth.
DEV_WITH_AUTH="${DEV_WITH_AUTH:-1}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
IDENTITY_PORT="${IDENTITY_PORT:-18081}"
MAILPIT_UI_PORT="${MAILPIT_UI_PORT:-18025}"
MAILPIT_SMTP_PORT="${MAILPIT_SMTP_PORT:-11025}"
LOCAL_OIDC_ISSUER="http://localhost:${KEYCLOAK_PORT}/realms/gryt"
LOCAL_IDENTITY_URL="http://localhost:${IDENTITY_PORT}"

if [[ "$DEV_WITH_AUTH" == "1" ]]; then
  GRYT_OIDC_ISSUER="${GRYT_OIDC_ISSUER:-$LOCAL_OIDC_ISSUER}"
  # The servers verify identity certificates against this, and the local CA
  # signs with its own key, so it has to be trusted explicitly.
  GRYT_TRUSTED_CERT_ISSUERS="${GRYT_TRUSTED_CERT_ISSUERS:-$LOCAL_IDENTITY_URL}"
else
  GRYT_OIDC_ISSUER="${GRYT_OIDC_ISSUER:-https://auth.gryt.chat/realms/gryt}"
  GRYT_TRUSTED_CERT_ISSUERS="${GRYT_TRUSTED_CERT_ISSUERS:-https://id.gryt.chat}"
fi
JWT_SECRET="${JWT_SECRET:-dev-secret-do-not-use-in-production}"
SERVER_PASSWORD="${SERVER_PASSWORD-changeme}"

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

# ── Docker deps (MinIO) ─────────────────────────────────────────────
if [[ "$DEV_WITH_S3" == "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required. Install Docker or set DEV_WITH_S3=0." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon is not running." >&2
    exit 1
  fi

  echo "Starting dev dependencies (MinIO)..."
  docker compose -f ops/deploy/compose/dev-deps.yml up -d --wait 2>/dev/null \
    || docker compose -f ops/deploy/compose/dev-deps.yml up -d

  wait_for_tcp 127.0.0.1 9000 "MinIO" 60
  wait_for_http "http://127.0.0.1:9000/minio/health/ready" "MinIO" 60 || true
  # Best-effort init (compose service) + explicit bucket ensure (so avatar/file uploads don't 502).
  docker compose -f ops/deploy/compose/dev-deps.yml up -d minio-init >/dev/null 2>&1 || true
  echo "Ensuring MinIO bucket exists: ${S3_BUCKET}"
  docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -lc "\
    mc alias set local http://127.0.0.1:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null 2>&1 \
    && mc mb -p 'local/${S3_BUCKET}' >/dev/null 2>&1 || true"
  echo ""
fi

# ── Local auth (Keycloak + Postgres) ─────────────────────────────────
if [[ "$DEV_WITH_AUTH" == "1" ]]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    # Warn and carry on rather than refuse. Wanting to work on the client is
    # not a reason to be blocked on a container runtime.
    echo "Docker is not available — falling back to production auth." >&2
    echo "Set DEV_WITH_AUTH=0 in ops/.env to silence this." >&2
    DEV_WITH_AUTH=0
    GRYT_OIDC_ISSUER="https://auth.gryt.chat/realms/gryt"
    GRYT_TRUSTED_CERT_ISSUERS="https://id.gryt.chat"
  else
    echo "Starting local auth (Keycloak + Postgres)..."
    # The compose file defaults to the production hostname, which Keycloak
    # enforces — it has to be told it is being reached on localhost or every
    # request 404s. GRYT_IMPORT_REALM=1 so a fresh database gets the gryt
    # realm; on subsequent starts the import is a no-op.
    export GRYT_KEYCLOAK_PORT="$KEYCLOAK_PORT"
    export GRYT_KEYCLOAK_HOSTNAME_URL="http://localhost:${KEYCLOAK_PORT}"
    export GRYT_KEYCLOAK_HOSTNAME_ADMIN_URL="http://localhost:${KEYCLOAK_PORT}"
    export GRYT_IMPORT_REALM=1
    # Point the realm's SMTP at Mailpit, so verification and password-reset
    # mail is catchable instead of undeliverable. Keycloak reaches it by
    # service name on the compose network, not through the published port.
    export GRYT_MAILPIT_UI_PORT="$MAILPIT_UI_PORT"
    export GRYT_MAILPIT_SMTP_PORT="$MAILPIT_SMTP_PORT"
    export GRYT_SMTP_HOST="mailpit"
    export GRYT_SMTP_PORT="1025"
    export GRYT_SMTP_FROM="dev@gryt.local"
    export GRYT_SMTP_FROM_NAME="Gryt (dev)"
    export GRYT_SMTP_USER="dev"
    export GRYT_SMTP_PASS="dev"
    export GRYT_KEYCLOAK_ADMIN_USERNAME="$KEYCLOAK_ADMIN_USER"
    export GRYT_KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD"

    docker compose -f packages/auth/docker-compose.keycloak.yml \
      up -d postgres keycloak mailpit \
      >/dev/null 2>&1 || docker compose -f packages/auth/docker-compose.keycloak.yml up -d postgres keycloak mailpit

    wait_for_http "http://localhost:${KEYCLOAK_PORT}/realms/gryt/.well-known/openid-configuration" "Keycloak realm" 120 || {
      echo "Keycloak did not come up with the gryt realm." >&2
      echo "Check: docker logs gryt-auth-keycloak-import" >&2
    }

    # Make sure there is an admin to log in as.
    #
    # KC_BOOTSTRAP_ADMIN_* only creates one when the database is empty, and the
    # realm import runs first and initialises the master realm — so on a fresh
    # volume the database is no longer empty by the time the server starts, the
    # bootstrap is skipped, and you get a Keycloak with no way into the console.
    # Creating it explicitly is idempotent enough: it fails harmlessly when the
    # user already exists.
    #
    # The management port has to be moved because the running server already
    # holds 9000 inside that container.
    if ! curl -fsS -X POST "http://localhost:${KEYCLOAK_PORT}/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" -d "username=${KEYCLOAK_ADMIN_USER}" \
        -d "password=${KEYCLOAK_ADMIN_PASSWORD}" -d "grant_type=password" >/dev/null 2>&1; then
      echo "Creating Keycloak admin user '${KEYCLOAK_ADMIN_USER}'..."
      docker exec -e KC_PASS="${KEYCLOAK_ADMIN_PASSWORD}" -e KC_HTTP_MANAGEMENT_PORT=9099 \
        gryt-auth-keycloak /opt/keycloak/bin/kc.sh bootstrap-admin user \
        --username "${KEYCLOAK_ADMIN_USER}" --password:env KC_PASS >/dev/null 2>&1 \
        || echo "  (could not create it — check: docker logs gryt-auth-keycloak)" >&2
    fi
    echo ""
  fi
fi

# ── Install JS dependencies ──────────────────────────────────────────
echo "Installing JS dependencies..."
(cd packages/client && yarn install --silent) &
(cd packages/server && yarn install --silent) &
[[ "$DEV_WITH_AUTH" == "1" ]] && (cd packages/auth/identity && yarn install --silent) &
wait
echo ""

# ── Build env strings for servers ────────────────────────────────────
WS_S3_ENV="$S3_DISABLE_ENV"
[[ "$DEV_WITH_S3" == "1" ]] && WS_S3_ENV="$S3_ENV"

COMMON_ENV="HOST=${HOST} CORS_ORIGIN=${CORS_ORIGIN} GRYT_AUTH_MODE=${GRYT_AUTH_MODE} GRYT_IDENTITY_TIERS=${GRYT_IDENTITY_TIERS} GRYT_OIDC_ISSUER=${GRYT_OIDC_ISSUER} GRYT_OIDC_AUDIENCE=${GRYT_OIDC_AUDIENCE} GRYT_TRUSTED_CERT_ISSUERS=${GRYT_TRUSTED_CERT_ISSUERS} JWT_SECRET=${JWT_SECRET} SERVER_PASSWORD=${SERVER_PASSWORD} SFU_WS_HOST=${SFU_WS_HOST} SFU_PUBLIC_HOST=${SFU_PUBLIC_HOST} STUN_SERVERS=${STUN_SERVERS} ${WS_S3_ENV}"

# The client reads these at build time through config.ts. Without them the
# browser would still send people to production Keycloak to sign in, while the
# servers only trusted the local CA — a mismatch that fails at join with a
# rejected certificate rather than anywhere useful.
CLIENT_ENV=""
if [[ "$DEV_WITH_AUTH" == "1" ]]; then
  CLIENT_ENV="VITE_GRYT_OIDC_ISSUER=${GRYT_OIDC_ISSUER} VITE_GRYT_IDENTITY_URL=${LOCAL_IDENTITY_URL}"
fi

# ── Create tmux session with separate windows ────────────────────────
if [[ "$DEV_WITH_AUTH" == "1" ]]; then
  echo "Creating tmux session '$SESSION' with 6 windows..."
  echo "  [0] sfu   [1] client   [2] ws1   [3] ws2   [4] identity   [5] shell"
  echo "  Ctrl+B then 0-5 to switch, Ctrl+B w for window list."
  echo ""
  echo "  Auth:     http://localhost:${KEYCLOAK_PORT}  (${KEYCLOAK_ADMIN_USER} / ${KEYCLOAK_ADMIN_PASSWORD})"
  echo "  Identity: ${LOCAL_IDENTITY_URL}"
  echo "  Mail:     http://localhost:${MAILPIT_UI_PORT}  (every email the realm sends)"
else
  echo "Creating tmux session '$SESSION' with 5 windows..."
  echo "  [0] sfu   [1] client   [2] ws1   [3] ws2   [4] shell"
  echo "  Ctrl+B then 0-4 to switch, Ctrl+B w for window list."
  echo ""
  echo "  Auth: production (DEV_WITH_AUTH=0)"
fi
echo ""

# Window 0: SFU
tmux new-session -d -s "$SESSION" -n sfu \
  "bash -lc 'export PATH=\"/usr/local/go/bin:\$PATH\"; cd packages/sfu && echo \"── SFU ──\" && ./start.sh; exec bash'"

# Window 1: Client (Vite)
tmux new-window -t "$SESSION" -n client \
  "bash -lc 'cd packages/client && echo \"── Client ──\" && env ${CLIENT_ENV} yarn dev --host; exec bash'"

# Window 2: Server 1 (ws1) on :5001
# Each instance needs its own DATA_DIR — servers are fully independent, and two
# processes on one SQLite file race for the write lock ("database is locked").
tmux new-window -t "$SESSION" -n ws1 \
  "bash -lc 'cd packages/server && echo \"── ws1 :5001 ──\" && env PORT=5001 SERVER_NAME=ws1 SERVER_INSTANCE_ID=ws1 DATA_DIR=./data/ws1 ${COMMON_ENV} yarn dev; exec bash'"

# Window 3: Server 2 (ws2) on :5002
tmux new-window -t "$SESSION" -n ws2 \
  "bash -lc 'cd packages/server && echo \"── ws2 :5002 ──\" && env PORT=5002 SERVER_NAME=ws2 SERVER_INSTANCE_ID=ws2 DATA_DIR=./data/ws2 ${COMMON_ENV} yarn dev; exec bash'"

# Window 4: identity CA (host, not Docker — see the note by DEV_WITH_AUTH)
if [[ "$DEV_WITH_AUTH" == "1" ]]; then
  tmux new-window -t "$SESSION" -n identity \
    "bash -lc 'cd packages/auth/identity && echo \"── Identity CA :${IDENTITY_PORT} ──\" && env PORT=${IDENTITY_PORT} GRYT_OIDC_ISSUER=${GRYT_OIDC_ISSUER} GRYT_IDENTITY_ORIGIN=${LOCAL_IDENTITY_URL} GRYT_IDENTITY_DATA_DIR=./data yarn dev; exec bash'"
fi

# Window 5: spare shell for ad-hoc commands
tmux new-window -t "$SESSION" -n shell

# Start on the client window
tmux select-window -t "$SESSION":1

tmux attach -t "$SESSION"
