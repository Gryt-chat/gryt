#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()   { echo -e "${RED}✖${RESET}  $*" >&2; }

REGISTRY="ghcr.io/gryt-chat"
IMAGES=(server sfu client)

# ── GHCR auth ────────────────────────────────────────────────────────────
if [ -z "${GH_TOKEN:-}" ]; then
  if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
    export GH_TOKEN=$(gh auth token)
    ok "Using GitHub token from gh CLI"
  else
    err "GH_TOKEN is not set and gh CLI is not authenticated."
    echo "   Set it with:  export GH_TOKEN=ghp_your_token_here"
    echo "   Or run:       gh auth login"
    exit 1
  fi
fi

echo "$GH_TOKEN" | docker login ghcr.io -u "$(gh api user -q .login 2>/dev/null || echo gryt)" --password-stdin 2>/dev/null
ok "Logged in to ghcr.io"

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│    Promote Beta → Production             │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────┘${RESET}"
echo ""

info "This will re-tag ${BOLD}:latest-beta${RESET} as ${BOLD}:latest${RESET} for:"
for img in "${IMAGES[@]}"; do
  echo "   • ${REGISTRY}/${img}"
done
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Proceed? ${YELLOW}[Y/n]${RESET}: ")" CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  warn "Aborted."
  exit 0
fi

echo ""
for img in "${IMAGES[@]}"; do
  FULL="${REGISTRY}/${img}"

  info "Pulling ${BOLD}${FULL}:latest-beta${RESET}…"
  if ! docker pull "${FULL}:latest-beta"; then
    err "Failed to pull ${FULL}:latest-beta — skipping"
    continue
  fi

  info "Re-tagging as ${BOLD}:latest${RESET}…"
  docker tag "${FULL}:latest-beta" "${FULL}:latest"

  info "Pushing ${BOLD}${FULL}:latest${RESET}…"
  docker push "${FULL}:latest"
  ok "${img} promoted"
  echo ""
done

ok "All images promoted to ${BOLD}:latest${RESET}"

# ── Promote GitHub prereleases to stable ──────────────────────────────────
# This makes the latest prerelease visible to Electron auto-update users
# who don't have the beta toggle enabled.
echo ""
info "Promoting latest GitHub prereleases to stable…"

GH_REPOS=("Gryt-chat/gryt" "Gryt-chat/server" "Gryt-chat/sfu")
for repo in "${GH_REPOS[@]}"; do
  TAG=$(gh release list --repo "$repo" --limit 1 --json tagName,isPrerelease -q '.[] | select(.isPrerelease) | .tagName' 2>/dev/null || true)
  if [ -n "$TAG" ]; then
    gh release edit "$TAG" --repo "$repo" --prerelease=false --latest 2>/dev/null && \
      ok "${repo} release ${BOLD}${TAG}${RESET} promoted to stable" || \
      warn "Failed to promote ${repo} release ${TAG}"
  else
    warn "No prerelease found for ${repo} — skipping"
  fi
done

# ── Optionally update production ──────────────────────────────────────────
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Run update-prod.sh now? ${YELLOW}[Y/n]${RESET}: ")" UPDATE_PROD
UPDATE_PROD="${UPDATE_PROD:-Y}"
if [[ "$UPDATE_PROD" =~ ^[Yy]$ ]]; then
  if [ -f "$SCRIPT_DIR/update-prod.sh" ]; then
    info "Running production update…"
    bash "$SCRIPT_DIR/update-prod.sh"
    ok "Production updated"
  else
    warn "update-prod.sh not found at $SCRIPT_DIR/update-prod.sh"
  fi
fi

echo ""
ok "Promotion complete"
echo ""
