#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SESSION="gryt-release"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()   { echo -e "${RED}✖${RESET}  $*" >&2; }

# ── --attach flag ─────────────────────────────────────────────────────
if [[ "${1:-}" == "--attach" ]]; then
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    exec tmux attach -t "$SESSION"
  else
    err "No '$SESSION' tmux session found."
    exit 1
  fi
fi

# ── Package registry ─────────────────────────────────────────────────
#   name | github_repo | release_script | description
PACKAGES=(
  "client|Gryt-chat/gryt|packages/client/scripts/release.sh|Electron + Docker client"
  "server|Gryt-chat/server|packages/server/scripts/release.sh|Signaling server"
  "sfu|Gryt-chat/sfu|packages/sfu/scripts/release.sh|Media server (SFU)"
  "image-worker|Gryt-chat/image-worker|packages/image-worker/scripts/release.sh|Image processing worker"
)

# ── Fetch latest release + detect changes ─────────────────────────────
PKG_NAMES=()
PKG_VERSIONS=()
PKG_CHANGES=()
PKG_CHANGED_IDX=()

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│         Gryt — Release Manager           │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────┘${RESET}"
echo ""
info "Scanning packages for changes…"
echo ""

for i in "${!PACKAGES[@]}"; do
  IFS='|' read -r name repo script desc <<< "${PACKAGES[$i]}"

  # Fetch latest release tag from GitHub (including prereleases)
  tag=$(gh release list --repo "$repo" --limit 1 2>/dev/null | head -1 | cut -f3)
  tag="${tag:-}"

  if [[ -z "$tag" ]]; then
    version="unreleased"
    commit_count="new"
  else
    version="$tag"
    sub_dir="$ROOT_DIR/packages/$name"
    commit_count="?"

    # 1) Tag lives in the submodule itself (server, sfu)
    if git -C "$sub_dir" rev-parse "$tag" &>/dev/null; then
      commit_count=$(git -C "$sub_dir" rev-list "$tag"..HEAD --count 2>/dev/null || echo "?")
    else
      git -C "$sub_dir" fetch --tags --quiet 2>/dev/null || true
      if git -C "$sub_dir" rev-parse "$tag" &>/dev/null; then
        commit_count=$(git -C "$sub_dir" rev-list "$tag"..HEAD --count 2>/dev/null || echo "?")
      fi
    fi

    # 2) Tag lives in the parent repo (client releases on Gryt-chat/gryt).
    #    Resolve the submodule commit recorded at that tag, then count from there.
    if [[ "$commit_count" == "?" ]]; then
      git -C "$ROOT_DIR" fetch --tags --quiet 2>/dev/null || true
      pinned=$(git -C "$ROOT_DIR" rev-parse "$tag:packages/$name" 2>/dev/null || echo "")
      if [[ -n "$pinned" ]]; then
        commit_count=$(git -C "$sub_dir" rev-list "$pinned"..HEAD --count 2>/dev/null || echo "?")
      fi
    fi
  fi

  PKG_NAMES+=("$name")
  PKG_VERSIONS+=("$version")
  PKG_CHANGES+=("$commit_count")

  if [[ "$commit_count" != "0" ]]; then
    PKG_CHANGED_IDX+=("$i")
  fi
done

# ── Display table ─────────────────────────────────────────────────────
printf "   ${DIM}%-4s %-10s %-16s %-20s %s${RESET}\n" "#" "Package" "Latest Release" "Changes" "Description"
printf "   ${DIM}%-4s %-10s %-16s %-20s %s${RESET}\n" "──" "──────────" "────────────────" "────────────────────" "───────────────────"

for i in "${!PACKAGES[@]}"; do
  IFS='|' read -r name repo script desc <<< "${PACKAGES[$i]}"
  num=$((i + 1))
  ver="${PKG_VERSIONS[$i]}"
  changes="${PKG_CHANGES[$i]}"

  if [[ "$changes" == "0" ]]; then
    change_str="${GREEN}✔ up to date${RESET}"
  elif [[ "$changes" == "new" ]]; then
    change_str="${YELLOW}★ unreleased${RESET}"
  elif [[ "$changes" == "?" ]]; then
    change_str="${YELLOW}? unknown${RESET}"
  elif [[ "$changes" == "1" ]]; then
    change_str="${YELLOW}● 1 commit${RESET}"
  else
    change_str="${YELLOW}● ${changes} commits${RESET}"
  fi

  printf "   %-4s ${BOLD}%-10s${RESET} ${YELLOW}%-16s${RESET} %-20b %s\n" "$num)" "$name" "$ver" "$change_str" "$desc"
done

echo ""

# ── Auto-select changed packages ─────────────────────────────────────
if [[ ${#PKG_CHANGED_IDX[@]} -eq 0 ]]; then
  ok "All packages are up to date."
  echo ""
  read -rp "$(echo -e "${CYAN}?${RESET}  Enter package numbers to release anyway (e.g. 1 3), or q to quit: ")" SELECTION
  [[ "$SELECTION" == "q" || -z "$SELECTION" ]] && exit 0
else
  changed_names=()
  changed_nums=()
  for idx in "${PKG_CHANGED_IDX[@]}"; do
    changed_names+=("${PKG_NAMES[$idx]}")
    changed_nums+=("$((idx + 1))")
  done

  info "Auto-selected: ${BOLD}${changed_names[*]}${RESET}"
  echo ""
  read -rp "$(echo -e "${CYAN}?${RESET}  Press Enter to confirm, or type package numbers to override (e.g. 1 3): ")" SELECTION

  if [[ -z "$SELECTION" ]]; then
    SELECTION="${changed_nums[*]}"
  fi
fi

# ── Parse selection ───────────────────────────────────────────────────
SELECTED_IDX=()
for num in $SELECTION; do
  idx=$((num - 1))
  if [[ $idx -ge 0 && $idx -lt ${#PACKAGES[@]} ]]; then
    SELECTED_IDX+=("$idx")
  else
    err "Invalid package number: $num"
    exit 1
  fi
done

if [[ ${#SELECTED_IDX[@]} -eq 0 ]]; then
  err "No packages selected."
  exit 1
fi

# ── Channel ──────────────────────────────────────────────────────────
echo ""
info "Release channel:"
echo "   1) Beta    — prerelease, deploys to beta  (default)"
echo "   2) Latest  — stable, deploys to beta + production"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Channel ${YELLOW}[1]${RESET}: ")" CHANNEL_CHOICE
CHANNEL_CHOICE="${CHANNEL_CHOICE:-1}"
case "$CHANNEL_CHOICE" in
  1) export CHANNEL="beta" ;;
  2) export CHANNEL="latest" ;;
  *) err "Invalid choice"; exit 1 ;;
esac
ok "Channel: ${BOLD}${CHANNEL}${RESET}"

# ── Single package: run directly ──────────────────────────────────────
if [[ ${#SELECTED_IDX[@]} -eq 1 ]]; then
  idx="${SELECTED_IDX[0]}"
  IFS='|' read -r name repo script desc <<< "${PACKAGES[$idx]}"
  echo ""
  ok "Launching ${BOLD}$name${RESET} release…"
  exec bash "$ROOT_DIR/$script"
fi

# ── Multiple packages: launch tmux ────────────────────────────────────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  warn "Killing existing '$SESSION' tmux session…"
  tmux kill-session -t "$SESSION"
  sleep 0.5
fi

echo ""
selected_names=()
for idx in "${SELECTED_IDX[@]}"; do
  selected_names+=("${PKG_NAMES[$idx]}")
done
info "Launching tmux session for: ${BOLD}${selected_names[*]}${RESET}"
echo -e "   ${DIM}Ctrl+B then arrow keys to switch panes, Ctrl+B z to zoom.${RESET}"
echo ""

first=true
for idx in "${SELECTED_IDX[@]}"; do
  IFS='|' read -r name repo script desc <<< "${PACKAGES[$idx]}"
  cmd="bash -lc 'cd \"$ROOT_DIR\" && bash $script; exec bash'"

  if $first; then
    tmux new-session -d -s "$SESSION" -n release "$cmd"
    first=false
  else
    tmux split-window -t "$SESSION" -h "$cmd"
  fi
done

tmux select-layout -t "$SESSION" even-horizontal
tmux select-pane -t "$SESSION".0
tmux attach -t "$SESSION"
