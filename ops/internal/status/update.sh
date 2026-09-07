#!/usr/bin/env bash
#
# Keeps the status page and the console current on the VPS.
#
# Written because merging a pull request used to change nothing here: the deploy
# was `scp`, so gryt#223 landed and the box carried on running the old compose
# file until somebody noticed. The Pi has polled on a timer for months; this is
# the same idea, minus the building — nothing is built on this box.

set -u

# Overridable so a change to this script can be exercised against scratch
# directories before it is trusted with the real ones.
SRC="${CONSOLE_SRC:-/opt/gryt-src}"
DEST="${CONSOLE_DEST:-/opt/gryt-status}"
COMPOSE="$DEST/docker-compose.yml"
STATE="$DEST/.deployed"

# First retry after 5 min, then 10, 20, 40... capped at 6 hours.
RETRY_BASE=300
RETRY_CAP=21600

mkdir -p "$STATE"

exec 9>"$DEST/.update.lock"
flock -n 9 || {
    echo "[$(date -Is)] updater already running; skipping"
    exit 0
}

retry_delay() {
    local fails="$1" delay=$((RETRY_BASE * (2 ** (fails - 1))))
    (( delay > RETRY_CAP )) && delay=$RETRY_CAP
    echo "$delay"
}

# ── The config, which lives in git ───────────────────────────────────────

# The files the sync owns. Everything else in $DEST is either written by the
# console or holds the password, and is never touched.
#
# This script is one of them. Without that, a change to it merges and never
# runs: the copy in git updates and the copy being executed does not, which is
# exactly the "merged, deployed nothing" the timer exists to end. The systemd
# units are not here — changing those needs a daemon-reload, so they stay a
# documented one-off.
SYNCED=(
    "docker-compose.yml:$DEST/docker-compose.yml"
    "README.md:$DEST/README.md"
    "config/config.yaml:$DEST/config/config.yaml"
    "update.sh:$DEST/update.sh"
)

files_match() {
    local pair src dest
    for pair in "${SYNCED[@]}"; do
        src="$SRC/ops/internal/status/${pair%%:*}"
        dest="${pair#*:}"
        cmp -s "$src" "$dest" || return 1
    done
    return 0
}

update_config() {
    local head target

    echo
    echo "[$(date -Is)] [config] checking"

    if [[ ! -d "$SRC/.git" ]]; then
        echo "[$(date -Is)] [config] no clone at $SRC; see README"
        return 1
    fi

    if ! git -C "$SRC" fetch --quiet origin main; then
        echo "[$(date -Is)] [config] git fetch failed"
        return 1
    fi

    head="$(git -C "$SRC" rev-parse HEAD)"
    target="$(git -C "$SRC" rev-parse origin/main)"

    if [[ "$head" != "$target" ]]; then
        if ! git -C "$SRC" merge --ff-only --quiet origin/main; then
            echo "[$(date -Is)] [config] not a fast-forward; leaving it alone"
            return 1
        fi
        echo "[$(date -Is)] [config] ${head:0:8} -> ${target:0:8}"
    fi

    # What is deployed, not what git did. A clone made at the current commit
    # never moves, so a check on git alone would call the box current while it
    # ran something else entirely — which is how a fresh install would sit
    # undeployed forever, silently, saying "current" every five minutes.
    if files_match; then
        echo "[$(date -Is)] [config] current ${target:0:8}"
        return 0
    fi

    echo "[$(date -Is)] [config] deployed files differ from ${target:0:8}"

    # Gatus exits on a config it cannot parse, and the status page goes with it.
    # Checking a copy first costs 25 seconds and the alternative is the page
    # being down during whatever it was meant to be reporting.
    rm -rf /tmp/gatus-validate-config
    cp -r "$SRC/ops/internal/status/config" /tmp/gatus-validate-config

    # Named and removed explicitly, never `--rm` into a pipe.
    #
    # `docker run --rm ... | grep -q` looks right and leaks a container every
    # time: grep exits on its first match, the SIGPIPE kills the docker client,
    # and the container it was attached to keeps running. Six of them piled up
    # on this box in five minutes, and the one from 2026-09-03 has the same
    # cause — the validate command in this README, which is written that way.
    local name="gatus-validate-$$"
    docker rm -f "$name" >/dev/null 2>&1 || true

    docker run -d --name "$name" \
        -v /tmp/gatus-validate-config:/config:ro \
        -v /tmp/gatus-validate-data:/data \
        -e GATUS_CONFIG_PATH=/config \
        twinproduction/gatus:v5.36.0 >/dev/null 2>&1 || true

    local ok=1 i
    for i in $(seq 1 20); do
        sleep 1
        if docker logs "$name" 2>&1 | grep -q "Validated"; then ok=0; break; fi
        docker inspect "$name" --format '{{.State.Running}}' 2>/dev/null | grep -q true || break
    done

    docker rm -f "$name" >/dev/null 2>&1 || true

    if (( ok != 0 )); then
        echo "[$(date -Is)] [config] the new config did not validate; keeping the old one"
        return 1
    fi

    # Named files, never the directory. `.env` holds CONSOLE_PASSWORD_HASH, is
    # not in git, and a wholesale copy would delete it and lock everybody out of
    # the console. announcements.yaml is written by the console and is not in
    # git either.
    # Written beside and renamed, never copied over in place. bash reads a
    # script as it runs, so overwriting this file mid-execution would hand the
    # running shell the second half of a different one. A rename swaps the
    # name and leaves the open inode alone.
    #
    # It also matters for the Gatus config, which is watched: a half-written
    # file is a config that does not parse.
    local pair dest
    for pair in "${SYNCED[@]}"; do
        dest="${pair#*:}"
        cp "$SRC/ops/internal/status/${pair%%:*}" "$dest.incoming"
        chmod --reference="$dest" "$dest.incoming" 2>/dev/null || true
        mv "$dest.incoming" "$dest"
    done

    if ! docker compose -f "$COMPOSE" up -d; then
        echo "[$(date -Is)] [config] deploy failed"
        return 1
    fi

    echo "[$(date -Is)] [config] deployed ${target:0:8}"

    # A new copy of this script takes effect next cycle; this shell goes on
    # running the code it started with.
}

# ── The console, which lives in a registry ───────────────────────────────

update_image() {
    local service="$1" container="$2"
    local image before after

    echo
    echo "[$(date -Is)] [$service] checking"

    image="$(docker inspect "$container" --format '{{.Config.Image}}' 2>/dev/null)"

    if [[ -z "$image" ]]; then
        echo "[$(date -Is)] [$service] no container named $container; skipping"
        return 1
    fi

    before="$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null)"

    if ! docker pull --quiet "$image" >/dev/null; then
        echo "[$(date -Is)] [$service] pull of $image failed; running container untouched"
        return 1
    fi

    after="$(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null)"

    if [[ "$before" == "$after" ]]; then
        echo "[$(date -Is)] [$service] current ${after:7:12}"
        return 0
    fi

    echo "[$(date -Is)] [$service] image ${before:7:12} -> ${after:7:12}"

    if ! docker compose -f "$COMPOSE" up -d --no-deps "$service"; then
        echo "[$(date -Is)] [$service] deploy failed"
        return 1
    fi

    echo "[$(date -Is)] [$service] deployed ${after:7:12}"
}

status=0

# Config first: a compose change may be what introduces the service the pull
# below is for.
update_config || status=1
update_image console gryt-status-console || status=1

if (( status != 0 )); then
    fails=$(( $(cat "$STATE/fails" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" > "$STATE/fails"
    echo
    echo "[$(date -Is)] something failed; next attempt in $(retry_delay "$fails")s at the earliest"
else
    rm -f "$STATE/fails"
fi

exit 0
