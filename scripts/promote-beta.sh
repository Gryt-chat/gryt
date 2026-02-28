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

rename_release_assets() {
  local repo="$1" release_id="$2" old_ver="$3" new_ver="$4" tag="$5"

  if [ "$old_ver" = "$new_ver" ]; then return; fi

  info "Renaming release assets: ${BOLD}${old_ver}${RESET} → ${BOLD}${new_ver}${RESET}…"

  local asset_lines
  asset_lines=$(gh api "repos/${repo}/releases/${release_id}/assets" \
    --jq '.[] | select(.name | contains("'"$old_ver"'")) | "\(.id)\t\(.name)"' 2>/dev/null || true)

  if [ -z "$asset_lines" ]; then return; fi

  while IFS=$'\t' read -r asset_id asset_name; do
    local new_name="${asset_name//$old_ver/$new_ver}"

    if [[ "$asset_name" =~ \.yml$ ]]; then
      local tmp_dir
      tmp_dir=$(mktemp -d)
      gh api "repos/${repo}/releases/assets/${asset_id}" \
        -H "Accept: application/octet-stream" 2>/dev/null \
        | sed "s/${old_ver}/${new_ver}/g" > "${tmp_dir}/${new_name}" || {
        rm -rf "$tmp_dir"; continue
      }
      gh api "repos/${repo}/releases/assets/${asset_id}" -X DELETE 2>/dev/null || true
      gh release upload "$tag" "${tmp_dir}/${new_name}" --repo "$repo" 2>/dev/null && \
        ok "  ${asset_name} → ${new_name} (content updated)" || \
        warn "  Failed to upload ${new_name}"
      rm -rf "$tmp_dir"
    else
      gh api "repos/${repo}/releases/assets/${asset_id}" -X PATCH \
        -f name="$new_name" 2>/dev/null && \
        ok "  ${asset_name} → ${new_name}" || \
        warn "  Failed to rename ${asset_name}"
    fi
  done <<< "$asset_lines"
}

REGISTRY="ghcr.io/gryt-chat"
IMAGES=(server sfu client image-worker)

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

  info "Promoting ${BOLD}${FULL}:latest-beta${RESET} → ${BOLD}:latest${RESET}…"
  if ! docker buildx imagetools create --tag "${FULL}:latest" "${FULL}:latest-beta"; then
    err "Failed to promote ${FULL}:latest-beta — skipping"
    continue
  fi
  ok "${img} promoted"
  echo ""
done

ok "All images promoted to ${BOLD}:latest${RESET}"

# ── Promote GitHub prereleases to stable ──────────────────────────────────
# This makes the latest prerelease visible to Electron auto-update users
# who don't have the beta toggle enabled.
echo ""
info "Promoting latest GitHub prereleases to stable…"

GH_REPOS=("Gryt-chat/gryt" "Gryt-chat/server" "Gryt-chat/sfu" "Gryt-chat/image-worker")
for repo in "${GH_REPOS[@]}"; do
  TAG=$(gh api "repos/${repo}/releases" --jq '[.[] | select(.prerelease)][0].tag_name' 2>/dev/null || true)
  if [ -z "$TAG" ]; then
    warn "No prerelease found for ${repo} — skipping"
    continue
  fi

  STABLE_TAG="${TAG%%-beta*}"
  STABLE_TITLE="${STABLE_TAG#v}"
  RELEASE_ID=$(gh api "repos/${repo}/releases" \
    --jq "[.[] | select(.tag_name == \"${TAG}\")][0].id" 2>/dev/null || true)

  if [ -z "$RELEASE_ID" ]; then
    warn "Could not find release ID for ${TAG} in ${repo}"
    continue
  fi

  if [ "$STABLE_TAG" != "$TAG" ]; then
    # Resolve the commit SHA behind the beta tag (dereference annotated tags)
    REF_TYPE=$(gh api "repos/${repo}/git/ref/tags/${TAG}" --jq '.object.type' 2>/dev/null || true)
    REF_SHA=$(gh api "repos/${repo}/git/ref/tags/${TAG}" --jq '.object.sha' 2>/dev/null || true)
    if [ "$REF_TYPE" = "tag" ]; then
      COMMIT_SHA=$(gh api "repos/${repo}/git/tags/${REF_SHA}" --jq '.object.sha' 2>/dev/null || true)
    else
      COMMIT_SHA="$REF_SHA"
    fi

    if [ -n "$COMMIT_SHA" ]; then
      gh api "repos/${repo}/git/refs" \
        -f ref="refs/tags/${STABLE_TAG}" -f sha="$COMMIT_SHA" 2>/dev/null || true
      gh api "repos/${repo}/releases/${RELEASE_ID}" -X PATCH \
        -f tag_name="$STABLE_TAG" -f name="$STABLE_TITLE" \
        -F prerelease=false -f make_latest=true 2>/dev/null && \
        ok "${repo} ${BOLD}${TAG}${RESET} → ${BOLD}${STABLE_TAG}${RESET}" || \
        warn "Failed to promote ${repo} ${TAG}"
      gh api "repos/${repo}/git/refs/tags/${TAG}" -X DELETE 2>/dev/null || true
      rename_release_assets "$repo" "$RELEASE_ID" "${TAG#v}" "$STABLE_TITLE" "$STABLE_TAG"
      continue
    fi
  fi

  # Fallback: promote without tag rename
  gh release edit "$TAG" --repo "$repo" --prerelease=false --latest --title "$STABLE_TITLE" 2>/dev/null && \
    ok "${repo} release ${BOLD}${TAG}${RESET} promoted to stable" || \
    warn "Failed to promote ${repo} release ${TAG}"
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
