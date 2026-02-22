#!/usr/bin/env bash
set -euo pipefail

SESSION="gryt-release"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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

echo "Creating tmux session '$SESSION' with split panes..."
echo "  Ctrl+B then arrow keys to switch panes, Ctrl+B z to zoom."
echo ""

# Left: Client (Electron + Docker)
tmux new-session -d -s "$SESSION" -n release \
  "bash -lc 'cd \"$ROOT_DIR\" && bash packages/client/scripts/release.sh; exec bash'"

# Middle: Server
tmux split-window -t "$SESSION" -h \
  "bash -lc 'cd \"$ROOT_DIR\" && bash packages/server/scripts/release.sh; exec bash'"

# Right: SFU
tmux split-window -t "$SESSION" -h \
  "bash -lc 'cd \"$ROOT_DIR\" && bash packages/sfu/scripts/release.sh; exec bash'"

tmux select-layout -t "$SESSION" even-horizontal
tmux select-pane -t "$SESSION".0
tmux attach -t "$SESSION"
