#!/usr/bin/env bash
# Install or remove the nightly Gryt image-update timer, idempotently.

#   curl -fsSL https://raw.githubusercontent.com/Gryt-chat/gryt/main/ops/deploy/auto-update/install.sh | sudo bash
#   curl -fsSL .../install.sh | sudo bash -s -- --uninstall

# Downloads the script and units from `main`, writes an env file only if one
# isn't there yet, enables the timer, and runs it once so you see the log.

# Picks up an existing /etc/default/gryt-web-client-refresh (the hand-install)
# under the new name, and leaves that old timer running for you to retire.

set -euo pipefail

RAW_BASE="${GRYT_AUTO_UPDATE_SOURCE:-https://raw.githubusercontent.com/Gryt-chat/gryt/main/ops/deploy/auto-update}"
BIN=/usr/local/bin/gryt-auto-update
ENV_FILE=/etc/default/gryt-auto-update
OLD_ENV_FILE=/etc/default/gryt-web-client-refresh
UNIT_DIR=/etc/systemd/system
SERVICE="$UNIT_DIR/gryt-auto-update.service"
TIMER="$UNIT_DIR/gryt-auto-update.timer"

log() { printf '%s\n' "$*"; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "install.sh: run this as root (sudo)" >&2
    exit 1
  fi
}

fetch() {
  curl -fsSL "$RAW_BASE/$1"
}

uninstall() {
  require_root
  systemctl disable --now gryt-auto-update.timer 2>/dev/null || true
  rm -f "$SERVICE" "$TIMER" "$BIN" "$ENV_FILE"
  systemctl daemon-reload
  log "Removed gryt-auto-update: the timer, the service, the script, and its env file."
}

install() {
  require_root
  command -v docker >/dev/null || { echo "install.sh: docker not found" >&2; exit 1; }
  command -v systemctl >/dev/null || { echo "install.sh: systemd not found — this installer needs it" >&2; exit 1; }

  fetch gryt-auto-update.sh > "$BIN.new"
  chmod +x "$BIN.new"
  mv "$BIN.new" "$BIN"

  fetch gryt-auto-update.service > "$SERVICE.new"
  mv "$SERVICE.new" "$SERVICE"
  fetch gryt-auto-update.timer > "$TIMER.new"
  mv "$TIMER.new" "$TIMER"

  # Never overwrite an existing env file — a re-run should not undo whatever
  # you have already set.
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "$OLD_ENV_FILE" ]]; then
      cp "$OLD_ENV_FILE" "$ENV_FILE"
      log "Found $OLD_ENV_FILE from the hand install and copied its settings to $ENV_FILE."
      log "The variable names did not change, so nothing else needs editing."
    else
      fetch gryt-auto-update.env.example > "$ENV_FILE.new"
      mv "$ENV_FILE.new" "$ENV_FILE"
    fi
    chmod 644 "$ENV_FILE"
  else
    log "$ENV_FILE already exists — leaving it alone."
  fi

  systemctl daemon-reload
  systemctl enable --now gryt-auto-update.timer

  if [[ -f "$OLD_ENV_FILE" ]] && systemctl is-enabled gryt-web-client-refresh.timer >/dev/null 2>&1; then
    log ""
    log "gryt-web-client-refresh.timer (the hand install) is still enabled."
    log "Once you have checked the log below, turn it off:"
    log "  systemctl disable --now gryt-web-client-refresh.timer"
  fi

  log ""
  log "Installed. Running it once now:"
  log ""
  systemctl start gryt-auto-update.service
  journalctl -u gryt-auto-update.service -n 20 --no-pager
  log ""
  log "Timer status: systemctl list-timers gryt-auto-update.timer"
  log "Log:          journalctl -u gryt-auto-update.service -n 50"
  log "Turn it off:  curl -fsSL $RAW_BASE/install.sh | sudo bash -s -- --uninstall"
}

case "${1:-}" in
  --uninstall) uninstall ;;
  "") install ;;
  *)
    echo "usage: install.sh [--uninstall]" >&2
    exit 1
    ;;
esac
