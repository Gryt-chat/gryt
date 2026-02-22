#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; }
err()   { echo -e "${RED}✖${RESET}  $*" >&2; }

get_version() {
  local pkg_dir="$1"
  if [ -f "$pkg_dir/package.json" ]; then
    node -p "require('$pkg_dir/package.json').version"
  elif [ -f "$pkg_dir/VERSION" ]; then
    tr -d '[:space:]' < "$pkg_dir/VERSION"
  else
    echo "?"
  fi
}

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│         Gryt — Release Manager           │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────┘${RESET}"
echo ""

info "Select a package to release:"
echo ""
echo -e "   1) ${BOLD}client (desktop)${RESET}  ${YELLOW}v$(get_version "$ROOT_DIR/packages/client")${RESET}  — Electron app → GitHub Releases"
echo -e "   2) ${BOLD}client (docker)${RESET}   ${YELLOW}v$(get_version "$ROOT_DIR/packages/client")${RESET}  — Web client → ghcr.io"
echo -e "   3) ${BOLD}server${RESET}            ${YELLOW}v$(get_version "$ROOT_DIR/packages/server")${RESET}  — Signaling server → ghcr.io"
echo -e "   4) ${BOLD}sfu${RESET}               ${YELLOW}v$(get_version "$ROOT_DIR/packages/sfu")${RESET}  — Media server → ghcr.io"
echo -e "   5) ${BOLD}site${RESET}              ${YELLOW}v$(get_version "$ROOT_DIR/packages/site")${RESET}  — Landing page → ghcr.io"
echo -e "   6) ${BOLD}docs${RESET}              ${YELLOW}v$(get_version "$ROOT_DIR/packages/docs")${RESET}  — Documentation → ghcr.io"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Package number: ")" PKG_NUM

case "${PKG_NUM}" in
  1) SCRIPT="$ROOT_DIR/packages/client/scripts/release.sh" ;;
  2) SCRIPT="$ROOT_DIR/packages/client/scripts/release-docker.sh" ;;
  3) SCRIPT="$ROOT_DIR/packages/server/scripts/release.sh" ;;
  4) SCRIPT="$ROOT_DIR/packages/sfu/scripts/release.sh" ;;
  5) SCRIPT="$ROOT_DIR/packages/site/scripts/release.sh" ;;
  6) SCRIPT="$ROOT_DIR/packages/docs/scripts/release.sh" ;;
  *) err "Invalid selection"; exit 1 ;;
esac

echo ""
ok "Launching release…"
exec bash "$SCRIPT"
