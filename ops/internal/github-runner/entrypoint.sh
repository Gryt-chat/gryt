#!/usr/bin/env bash
# Registers once with RUNNER_TOKEN and keeps the registration in /state, so a
# restart or a rebuild reconnects without a new token.
set -euo pipefail
cd /home/runner

files=(.runner .credentials .credentials_rsaparams)

if [[ -f /state/.runner ]]; then
  for f in "${files[@]}"; do cp "/state/$f" "$f"; done
else
  : "${RUNNER_REPO:?set RUNNER_REPO, e.g. Gryt-chat/gryt-cloud}"
  : "${RUNNER_TOKEN:?set RUNNER_TOKEN to a registration token for $RUNNER_REPO}"
  ./config.sh --unattended --replace \
    --url "https://github.com/$RUNNER_REPO" --token "$RUNNER_TOKEN" \
    --name "${RUNNER_NAME:-$(hostname)}" --labels gryt-private --work _work
  for f in "${files[@]}"; do cp "$f" "/state/$f"; done
fi

exec ./run.sh
