#!/bin/sh
# /tmp is private to each sandbox, so the single-instance lock has to live somewhere
# shared, or a gryt:// link starts a second copy instead of reaching the first.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
exec zypak-wrapper /app/lib/gryt-chat/gryt-chat "$@"
