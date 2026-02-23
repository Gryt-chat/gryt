#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="$ROOT_DIR/ops/deploy/compose/prod.yml"
ENV_FILE="$ROOT_DIR/ops/deploy/compose/.env.prod"

echo "Pulling latest images…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

echo "Restarting services…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate

echo "Done."
