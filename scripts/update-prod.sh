#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_DIR="$ROOT_DIR/ops/deploy/compose"
COMPOSE_FILE="$COMPOSE_DIR/prod.yml"
LOCAL_FILE="$COMPOSE_DIR/local.yml"
ENV_FILE="$COMPOSE_DIR/.env.prod"

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [[ -f "$LOCAL_FILE" ]]; then
  COMPOSE_ARGS+=(-f "$LOCAL_FILE")
  echo "Using local override: $LOCAL_FILE"
fi
COMPOSE_ARGS+=(--env-file "$ENV_FILE")

# Include monitoring profile if monitoring config exists
if [[ -f "$COMPOSE_DIR/monitoring/prometheus.yml" ]]; then
  COMPOSE_ARGS+=(--profile monitoring)
fi

echo "Pulling latest images…"
docker compose "${COMPOSE_ARGS[@]}" pull

echo "Restarting services…"
docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate

echo "Done."
