#!/usr/bin/env bash

set -u

# Overridable so a change can be tried against scratch directories first.
BASE="${GRYT_WEB_DIR:-/home/sivert/gryt}"
COMPOSE="$BASE/compose.yml"
STATE="$BASE/.deployed"

# First retry after 5 min, then 10, 20, 40...
# Cap repeated failures at 6 hours.
RETRY_BASE=300
RETRY_CAP=21600

# Twice the ui build's worst case on the Pi. A build that runs past it is stuck, and on
# 2026-09-07 one held the lock for 1h45m while site and docs waited behind it.
BUILD_TIMEOUT=40m

# BuildKit on Unraid, over mTLS. If it doesn't answer within the check, the build runs here.
REMOTE_BUILDER=gryt-unraid
REMOTE_CHECK_TIMEOUT=20s

# What this repository owns, as path in the checkout:where it runs. The systemd units
# aren't listed because installing them needs sudo.
SYNCED=(
    "ops/deploy/rpi/update.sh:$BASE/update.sh"
    "ops/deploy/rpi/compose.yml:$COMPOSE"
    "ops/deploy/rpi/Dockerfile.docs:$BASE/local/Dockerfile.docs"
)

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

# A broken update.sh can't deliver its own fix, so a file that fails this is never installed.
valid() {
    case "$1" in
        "$BASE/update.sh") bash -n "$2" ;;
        "$COMPOSE") docker compose -f "$2" config -q ;;
        *) return 0 ;;
    esac
}

# Compose recreates only the containers whose settings changed. A stopped one stays stopped.
apply_compose() {
    local running=()

    mapfile -t running < <(docker compose -f "$COMPOSE" ps --services --orphans=false)
    (( ${#running[@]} > 0 )) || return 0

    docker compose -f "$COMPOSE" up -d --no-deps --no-build "${running[@]}"
}

update_config() {
    local dirty head target pair src dest
    local changed=0 compose_changed=0 rc=0

    echo
    echo "[$(date -Is)] [config] checking"

    # Same rule as the site clones: never merge over a hand edit.
    dirty="$(git -C "$BASE" status --porcelain --untracked-files=no)"

    if [[ -n "$dirty" ]]; then
        echo "[$(date -Is)] [config] local tracked changes present; skipping"
        return 1
    fi

    if ! git -C "$BASE" fetch --quiet origin main; then
        echo "[$(date -Is)] [config] git fetch failed"
        return 1
    fi

    head="$(git -C "$BASE" rev-parse HEAD)"
    target="$(git -C "$BASE" rev-parse origin/main)"

    if [[ "$head" != "$target" ]] && ! git -C "$BASE" merge --ff-only --quiet origin/main; then
        echo "[$(date -Is)] [config] could not fast-forward to ${target:0:12}; skipping"
        return 1
    fi

    for pair in "${SYNCED[@]}"; do
        src="$BASE/${pair%%:*}"
        dest="${pair#*:}"

        cmp -s "$src" "$dest" && continue

        # Written beside and renamed. bash reads this script as it runs, so a copy over it
        # in place would hand the running shell half of the new one.
        mkdir -p "$(dirname "$dest")"
        rm -f "$dest.incoming"

        if ! cp "$src" "$dest.incoming" || ! valid "$dest" "$dest.incoming"; then
            rm -f "$dest.incoming"
            echo "[$(date -Is)] [config] ${pair%%:*} at ${target:0:12} not installed; keeping the old one"
            rc=1
            continue
        fi

        # The unit executes update.sh directly, so it keeps the running copy's mode
        # rather than whatever mode git checked out.
        chmod --reference="$dest" "$dest.incoming" 2>/dev/null || true
        mv "$dest.incoming" "$dest"
        changed=1
        echo "[$(date -Is)] [config] ${dest#"$BASE"/} updated"

        case "$dest" in
            "$COMPOSE") compose_changed=1 ;;
            */Dockerfile.docs) touch "$STATE/docs.rebuild"; rm -f "$STATE/docs.failed" ;;
        esac
    done

    if (( compose_changed )) && ! apply_compose; then
        echo "[$(date -Is)] [config] compose.yml changed but up -d failed"
        rc=1
    fi

    if (( rc != 0 )); then
        return 1
    fi

    if (( changed )); then
        echo "[$(date -Is)] [config] deployed ${target:0:12}"
    else
        echo "[$(date -Is)] [config] current ${target:0:12}"
    fi
}

remote_builder_up() {
    timeout "$REMOTE_CHECK_TIMEOUT" \
        docker buildx inspect --bootstrap "$REMOTE_BUILDER" 2>/dev/null \
        | grep -q '^Status: *running'
}

# Context, Dockerfile and tag per service. They have to match compose.yml, which the local
# fallback builds from.
build_args() {
    case "$1" in
        site) echo "$BASE/site $BASE/site/Dockerfile gryt-site:local" ;;
        docs) echo "$BASE/docs $BASE/local/Dockerfile.docs gryt-docs:local" ;;
        ui)   echo "$BASE/ui $BASE/ui/Dockerfile gryt-ui:local" ;;
        *)    return 1 ;;
    esac
}

# Returns the build's exit code, 124 on timeout, like a bare `timeout` would.
build_service() {
    local service="$1"
    local context dockerfile image status_code

    if ! read -r context dockerfile image < <(build_args "$service"); then
        echo "[$(date -Is)] [$service] no build definition for $service"
        return 1
    fi

    if remote_builder_up; then
        echo "[$(date -Is)] [$service] building on $REMOTE_BUILDER"

        # Not `docker compose build`: compose asks for `network: host`, and the remote
        # daemon refuses that entitlement.
        status_code=0
        timeout "$BUILD_TIMEOUT" docker buildx build \
            --builder "$REMOTE_BUILDER" \
            --platform linux/arm64 \
            --progress plain \
            --load \
            -f "$dockerfile" \
            -t "$image" \
            "$context" || status_code=$?

        # Only a builder that went away mid-build gets a local retry. A real failure would
        # fail again here, and take an hour doing it.
        if (( status_code == 0 || status_code == 124 )) || remote_builder_up; then
            return "$status_code"
        fi

        echo "[$(date -Is)] [$service] $REMOTE_BUILDER went away during the build; building locally"
    else
        echo "[$(date -Is)] [$service] $REMOTE_BUILDER unreachable; building locally"
    fi

    status_code=0
    timeout "$BUILD_TIMEOUT" docker compose -f "$COMPOSE" build "$service" || status_code=$?
    return "$status_code"
}

update_service() {
    local repo="$1"
    local service="$2"

    local dir="$BASE/$repo"
    local statefile="$STATE/$repo.sha"
    local failedfile="$STATE/$repo.failed"
    local rebuildfile="$STATE/$repo.rebuild"

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

    if [[ "$head" == "$target" && "$deployed" == "$target" && ! -e "$rebuildfile" ]]; then
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

    # A stuck build is killed and counted as a failure, so it backs off and the services
    # after it in this run still get their turn.
    local status_code=0
    local build_started=$SECONDS
    build_service "$service" || status_code=$?
    echo "[$(date -Is)] [$service] build finished in $((SECONDS - build_started))s (exit $status_code)"

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

        # 124 is `timeout`'s own exit code. A build that fails is usually the source, and
        # one that hangs is usually the box.
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
    rm -f "$failedfile" "$rebuildfile"

    echo "[$(date -Is)] [$service] deployed ${target:0:12}"
}

# The web clients are images, so there's no commit to compare. The tag stays the same and
# the id under it moves, which is what says a release happened.
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

# First, so a merged compose.yml or Dockerfile.docs is in place before anything builds.
update_config || status=1

# Deliberately serial. Never two builds at once.
update_service site site || status=1
update_service docs docs || status=1
update_service ui ui || status=1

update_image app gryt-app || status=1
update_image beta gryt-beta || status=1

exit "$status"
