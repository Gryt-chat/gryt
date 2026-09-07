#!/bin/sh
# Electron under a Flatpak runtime needs the sandbox disabled, because the
# runtime already is one and the chrome-sandbox binary is not setuid here.
exec zypak-wrapper /app/lib/gryt-chat/gryt-chat "$@"
