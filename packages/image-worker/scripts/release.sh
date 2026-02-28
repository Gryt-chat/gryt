#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_JSON="$PKG_DIR/package.json"
PKG_NAME="image-worker"
IMAGE="ghcr.io/gryt-chat/${PKG_NAME}"

OWNER="Gryt-chat"
REPO="$PKG_NAME"

CURRENT_VERSION=$(node -p "require('$PKG_JSON').version")

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

# ── Semver helpers ────────────────────────────────────────────────────────
bump_version() {
  local version="$1" part="$2"
  IFS='.' read -r major minor patch <<< "${version%%-*}"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

# ── GH_TOKEN ─────────────────────────────────────────────────────────────
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

echo "$GH_TOKEN" | docker login ghcr.io -u "$(gh api user -q .login 2>/dev/null || echo gryt)" --password-stdin
ok "Logged in to ghcr.io"

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│      Gryt Image Worker — Release         │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────┘${RESET}"
echo ""

# ── Version ──────────────────────────────────────────────────────────────
NEXT_PATCH=$(bump_version "$CURRENT_VERSION" patch)

info "Current version: ${BOLD}v${CURRENT_VERSION}${RESET}"
echo ""
info "Version bump:"
echo "   1) Patch  → v${NEXT_PATCH}  (default)"
echo "   2) Minor  → v$(bump_version "$CURRENT_VERSION" minor)"
echo "   3) Major  → v$(bump_version "$CURRENT_VERSION" major)"
echo "   4) Custom"
echo "   5) Re-release v${CURRENT_VERSION}"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Choice ${YELLOW}[1]${RESET}: ")" VERSION_CHOICE
VERSION_CHOICE="${VERSION_CHOICE:-1}"

RERELEASE=false
case "$VERSION_CHOICE" in
  1) NEW_VERSION="$NEXT_PATCH" ;;
  2) NEW_VERSION="$(bump_version "$CURRENT_VERSION" minor)" ;;
  3) NEW_VERSION="$(bump_version "$CURRENT_VERSION" major)" ;;
  4)
    read -rp "$(echo -e "${CYAN}?${RESET}  Enter version: ")" NEW_VERSION
    if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
      err "Invalid version: $NEW_VERSION (expected semver, e.g. 1.2.3)"
      exit 1
    fi
    ;;
  5) NEW_VERSION="$CURRENT_VERSION"; RERELEASE=true ;;
  *) err "Invalid choice"; exit 1 ;;
esac

# ── Beta / prerelease ────────────────────────────────────────────────────
BETA_RELEASE=false
RELEASE_TYPE="release"

if [ "$RERELEASE" = false ]; then
  if [[ "$CURRENT_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta(\.[0-9]+)?$ ]]; then
    CUR_BASE="${BASH_REMATCH[1]}"
    NEXT_BETA="$(bump_version "$CURRENT_VERSION" patch)-beta"
    echo ""
    info "Current version is beta (${BOLD}v${CURRENT_VERSION}${RESET}). Quick options:"
    echo "   a) Next beta patch     → v${NEXT_BETA}  (default)"
    echo "   b) Promote to stable   → v${CUR_BASE}"
    echo "   c) Keep selected       → v${NEW_VERSION}"
    echo ""
    read -rp "$(echo -e "${CYAN}?${RESET}  Choice ${YELLOW}[a]${RESET}: ")" BETA_CHOICE
    BETA_CHOICE="${BETA_CHOICE:-a}"
    case "$BETA_CHOICE" in
      a|A) NEW_VERSION="$NEXT_BETA"; BETA_RELEASE=true ;;
      b|B) NEW_VERSION="$CUR_BASE" ;;
      c|C) ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
  fi

  if [[ "$NEW_VERSION" =~ -beta ]]; then
    BETA_RELEASE=true
  fi

  if [ "$BETA_RELEASE" = false ] && [[ ! "$NEW_VERSION" =~ -beta ]]; then
    read -rp "$(echo -e "${CYAN}?${RESET}  Release as beta? ${YELLOW}[Y/n]${RESET}: ")" BETA_ASK
    BETA_ASK="${BETA_ASK:-Y}"
    if [[ "$BETA_ASK" =~ ^[Yy]$ ]]; then
      BETA_RELEASE=true
      NEW_VERSION="${NEW_VERSION}-beta"
    fi
  fi

  if [ "$BETA_RELEASE" = true ]; then
    RELEASE_TYPE="prerelease"
  fi
fi

cd "$PKG_DIR"

if [ "$RERELEASE" = true ]; then
  ok "Re-releasing ${BOLD}v${NEW_VERSION}${RESET}"
else
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  ok "Version bumped: ${BOLD}v${CURRENT_VERSION}${RESET} → ${BOLD}v${NEW_VERSION}${RESET}"
fi

# ── Confirm ──────────────────────────────────────────────────────────────
IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "${NEW_VERSION%%-*}"

echo ""
echo -e "${BOLD}── Summary ──────────────────────────────${RESET}"
if [ "$RERELEASE" = true ]; then
  echo -e "  Version:   ${YELLOW}v${NEW_VERSION} (re-release)${RESET}"
elif [ "$BETA_RELEASE" = true ]; then
  echo -e "  Version:   ${YELLOW}v${NEW_VERSION} (beta)${RESET}"
else
  echo -e "  Version:   ${GREEN}v${NEW_VERSION}${RESET}"
fi
echo -e "  Release:   ${GREEN}${RELEASE_TYPE}${RESET}"
echo -e "  Image:     ${GREEN}${IMAGE}:${NEW_VERSION}${RESET}"
echo -e "  Tags:      ${GREEN}${NEW_VERSION}, ${V_MAJOR}.${V_MINOR}, ${V_MAJOR}, latest-beta${RESET}"
echo -e "  Repo:      ${GREEN}${OWNER}/${REPO}${RESET}"
echo -e "${BOLD}─────────────────────────────────────────${RESET}"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Build, push, and tag? ${YELLOW}[Y/n]${RESET}: ")" CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  warn "Aborted."
  exit 0
fi

# ── Clean existing release (re-release only) ─────────────────────────────
if [ "$RERELEASE" = true ]; then
  echo ""
  info "Removing existing release v${NEW_VERSION}…"
  gh release delete "v${NEW_VERSION}" --repo "${OWNER}/${REPO}" --yes --cleanup-tag 2>/dev/null || true
  git tag -d "v${NEW_VERSION}" 2>/dev/null || true
fi

# ── Pre-flight checks ────────────────────────────────────────────────────
echo ""
info "Running pre-flight checks…"

cd "$PKG_DIR"

info "Type-checking…"
npx tsc --noEmit
ok "Type-check passed"

# ── Ensure lockfile is up to date ─────────────────────────────────────────
echo ""
info "Syncing dependencies…"
cd "$PKG_DIR"
yarn install --frozen-lockfile --ignore-engines
ok "Lockfile up to date"

# ── Docker build & push (multi-arch) ─────────────────────────────────────
echo ""
PLATFORMS="linux/amd64,linux/arm64"
info "Building & pushing multi-arch Docker image (${PLATFORMS})…"

docker buildx build \
  --platform "$PLATFORMS" \
  --cache-from type=registry,ref=${IMAGE}:buildcache \
  --cache-to type=registry,ref=${IMAGE}:buildcache,mode=max \
  -t "${IMAGE}:${NEW_VERSION}" \
  -t "${IMAGE}:${V_MAJOR}.${V_MINOR}" \
  -t "${IMAGE}:${V_MAJOR}" \
  -t "${IMAGE}:latest-beta" \
  --push .
ok "Pushed ${IMAGE}:${NEW_VERSION} (${PLATFORMS})"

# ── Git commit & push ────────────────────────────────────────────────────
if [ "$RERELEASE" = false ]; then
  echo ""
  info "Committing version bump…"

  COMMIT_SUFFIX=""
  if [ "$BETA_RELEASE" = true ]; then
    COMMIT_SUFFIX=" (beta)"
  fi

  cd "$PKG_DIR"
  git add package.json
  git commit -m "release: v${NEW_VERSION}${COMMIT_SUFFIX}"
  git push

  REPO_ROOT="$(cd "$PKG_DIR/.." && git rev-parse --show-toplevel 2>/dev/null || echo "")"
  if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/.gitmodules" ]; then
    cd "$REPO_ROOT"
    git add packages/image-worker
    git commit -m "release: image-worker v${NEW_VERSION}${COMMIT_SUFFIX}"
    git tag "image-worker-v${NEW_VERSION}"
    git push
    git push origin "image-worker-v${NEW_VERSION}"
    ok "Committed submodule + monorepo, tagged and pushed ${BOLD}image-worker-v${NEW_VERSION}${RESET}"
  else
    cd "$PKG_DIR"
    ok "Committed and pushed ${BOLD}v${NEW_VERSION}${RESET}"
  fi
fi

# ── GitHub release ────────────────────────────────────────────────────────
echo ""
info "Creating GitHub release…"

RELEASE_FLAGS="--prerelease"

gh release create "v${NEW_VERSION}" \
  --repo "${OWNER}/${REPO}" \
  --title "v${NEW_VERSION}" \
  --generate-notes \
  $RELEASE_FLAGS
ok "GitHub release created"

# ── Deploy to beta ───────────────────────────────────────────────────────
echo ""
REPO_ROOT="$(cd "$PKG_DIR/.." && git rev-parse --show-toplevel 2>/dev/null || echo "")"
read -rp "$(echo -e "${CYAN}?${RESET}  Deploy image-worker to beta? ${YELLOW}[Y/n]${RESET}: ")" DEPLOY_BETA
DEPLOY_BETA="${DEPLOY_BETA:-Y}"
if [[ "$DEPLOY_BETA" =~ ^[Yy]$ ]]; then
  COMPOSE_DIR="$REPO_ROOT/ops/deploy/compose"
  COMPOSE_FILE="$COMPOSE_DIR/beta.yml"
  ENV_FILE="$COMPOSE_DIR/.env.beta"
  LOCAL_FILE="$COMPOSE_DIR/beta.local.yml"
  if [ -n "$REPO_ROOT" ] && [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ]; then
    COMPOSE_ARGS=(-f "$COMPOSE_FILE")
    [[ -f "$LOCAL_FILE" ]] && COMPOSE_ARGS+=(-f "$LOCAL_FILE")
    COMPOSE_ARGS+=(--env-file "$ENV_FILE")
    info "Pulling & restarting beta image-worker…"
    docker compose "${COMPOSE_ARGS[@]}" pull image-worker
    docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate image-worker
    if docker compose "${COMPOSE_ARGS[@]}" ps --format '{{.Name}}' 2>/dev/null | grep -q image-worker-nt; then
      docker compose "${COMPOSE_ARGS[@]}" pull image-worker-nt
      docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate image-worker-nt
    fi
    ok "Beta image-worker deployed"
  else
    warn "Beta compose files not found"
  fi
fi

echo ""
ok "Release ${BOLD}v${NEW_VERSION}${RESET} complete"
echo ""
echo -e "  ${CYAN}Image:${RESET}     ${IMAGE}:${NEW_VERSION}"
echo -e "  ${CYAN}Release:${RESET}   https://github.com/${OWNER}/${REPO}/releases/tag/v${NEW_VERSION}"
echo ""
