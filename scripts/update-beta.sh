#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_DIR="$ROOT_DIR/ops/deploy/compose"
COMPOSE_FILE="$COMPOSE_DIR/beta.yml"
ENV_FILE="$COMPOSE_DIR/.env.beta"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Error: $COMPOSE_FILE not found"
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

COMPOSE_ARGS=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# Include web client
COMPOSE_ARGS+=(--profile web)

echo "Pulling latest-beta images…"
docker compose "${COMPOSE_ARGS[@]}" pull

echo "Restarting beta services…"
docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate

echo "Beta environment updated."
