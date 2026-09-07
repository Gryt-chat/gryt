#!/usr/bin/env bash

set -u

BASE="/home/sivert/gryt"
COMPOSE="$BASE/compose.yml"
STATE="$BASE/.deployed"

# First retry after 5 min, then 10, 20, 40...
# Cap repeated failures at 6 hours.
RETRY_BASE=300
RETRY_CAP=21600

# How long one image may take to build before it is given up on.
#
# This is the fix for the failure on 2026-09-07: a `bun install` inside the ui
# build wedged after printing "Slow filesystem detected", and because a build
# had no timeout it held the lock below for an hour and three quarters. Every
# cycle after it exited immediately on `flock -n`, so site and docs — which are
# quick, and which had merged changes waiting — were never checked again. Six
# merged pull requests sat undeployed until somebody looked at the box.
#
# Forty minutes is roughly twice the ui build's honest worst case on this Pi.
# A build that overruns it is not slow, it is stuck.
BUILD_TIMEOUT=40m

mkdir -p "$STATE"

# Extra protection against overlapping builds.
exec 9>"$BASE/.update.lock"
flock -n 9 || {
    echo "[$(date -Is)] updater already running; skipping"
    exit 0
}

retry_delay() {
    local attempts="$1"
    local delay="$RETRY_BASE"
    local i

    for ((i=1; i<attempts; i++)); do
        delay=$((delay * 2))
        if ((delay >= RETRY_CAP)); then
            echo "$RETRY_CAP"
            return
        fi
    done

    echo "$delay"
}

update_service() {
    local repo="$1"
    local service="$2"

    local dir="$BASE/$repo"
    local statefile="$STATE/$repo.sha"
    local failedfile="$STATE/$repo.failed"

    local head target deployed dirty
    local failed_commit attempts next_try now delay

    echo
    echo "[$(date -Is)] [$service] checking"

    # Never overwrite local tracked changes.
    dirty="$(git -C "$dir" status --porcelain --untracked-files=no)"

    if [[ -n "$dirty" ]]; then
        echo "[$(date -Is)] [$service] local tracked changes present; skipping"
        return 1
    fi

    if ! git -C "$dir" fetch --quiet origin main; then
        echo "[$(date -Is)] [$service] git fetch failed"
        return 1
    fi

    head="$(git -C "$dir" rev-parse HEAD)"
    target="$(git -C "$dir" rev-parse origin/main)"
    deployed="$(cat "$statefile" 2>/dev/null || echo unknown)"

    if [[ "$head" == "$target" && "$deployed" == "$target" ]]; then
        echo "[$(date -Is)] [$service] current ${target:0:12}"
        return 0
    fi

    # Handle retry backoff for the same failed commit.
    now="$(date +%s)"

    if [[ -f "$failedfile" ]]; then
        read -r failed_commit attempts next_try < "$failedfile"

        if [[ "$failed_commit" == "$target" && "$now" -lt "$next_try" ]]; then
            echo "[$(date -Is)] [$service] ${target:0:12} previously failed ${attempts}x; retry later"
            return 1
        fi
    else
        failed_commit=""
        attempts=0
        next_try=0
    fi

    # Only accept a clean fast-forward from the current checkout.
    if [[ "$head" != "$target" ]]; then
        if ! git -C "$dir" merge-base --is-ancestor "$head" "$target"; then
            echo "[$(date -Is)] [$service] origin/main is not a clean fast-forward; skipping"
            return 1
        fi

        if ! git -C "$dir" merge --ff-only --quiet origin/main; then
            echo "[$(date -Is)] [$service] fast-forward failed"
            return 1
        fi

        echo "[$(date -Is)] [$service] source ${head:0:12} -> ${target:0:12}"
    fi

    echo "[$(date -Is)] [$service] building ${target:0:12}"

    # `timeout` rather than a bare build. A stuck build is killed and counted as
    # a failure, which puts it on the retry backoff below and — crucially —
    # lets the services after it in this run carry on.
    local status_code=0
    timeout "$BUILD_TIMEOUT" docker compose -f "$COMPOSE" build "$service" || status_code=$?

    if (( status_code != 0 )); then
        if [[ "$failed_commit" != "$target" ]]; then
            attempts=0
        fi

        attempts=$((attempts + 1))
        delay="$(retry_delay "$attempts")"

        printf '%s %s %s\n' \
            "$target" \
            "$attempts" \
            "$((now + delay))" \
            > "$failedfile"

        # 124 is `timeout`'s own exit code. Worth separating: a build that
        # fails is usually the source, and one that hangs is usually the box.
        if (( status_code == 124 )); then
            echo "[$(date -Is)] [$service] BUILD TIMED OUT after $BUILD_TIMEOUT; running container untouched"
        else
            echo "[$(date -Is)] [$service] BUILD FAILED; running container untouched"
        fi
        return 1
    fi

    echo "[$(date -Is)] [$service] deploying"

    if ! docker compose -f "$COMPOSE" up -d --no-deps "$service"; then
        echo "[$(date -Is)] [$service] deploy failed"
        return 1
    fi

    printf '%s\n' "$target" > "$statefile"
    rm -f "$failedfile"

    echo "[$(date -Is)] [$service] deployed ${target:0:12}"
}

# The web clients are images, not build contexts, so there is no commit to
# compare against. The published tag stays the same and the id under it moves,
# which is the only thing that says a release happened.
#
# Nothing pulled these until this existed. The dev box's refresh script covers
# gryt-prod-client and gryt-beta-client, but those are leftovers on 3666 and
# 3667 that nothing routes to; app.gryt.chat and beta.gryt.chat are here.
update_image() {
    local service="$1"
    local container="$2"

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

# Deliberately serial. Never build both simultaneously.
update_service site site || status=1
update_service docs docs || status=1
update_service ui ui || status=1

# After the source builds, so a slow ui build never delays a client release.
update_image app gryt-app || status=1
update_image beta gryt-beta || status=1

exit "$status"
