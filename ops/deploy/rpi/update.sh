#!/usr/bin/env bash

set -u

# Overridable so a change can be tried against scratch directories first.
BASE="${GRYT_WEB_DIR:-/home/sivert/gryt}"
COMPOSE="$BASE/compose.yml"
STATE="$BASE/.deployed"
PROXY="$BASE/proxy"

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

# Counted from when the new container is up. Creating it can take minutes on the Pi, and the
# live one keeps serving meanwhile.
READY_TIMEOUT=180

# How long the old container keeps running after the switch, for requests it's still answering.
# The biggest file the site serves is an 8.8 MB video.
DRAIN=30

# Site, the port Caddy serves it on, the container's own port, and a path that has to answer
# before it goes live.
SITES=(
    "site 8080 80 /health"
    "docs 8081 3000 /"
    "app 8082 80 /health"
    "beta 8083 80 /health"
    "ui 8084 80 /health"
)

# The services that held those ports themselves before the proxy.
DIRECT=(site docs app beta ui)
DIRECT_MARKER="$STATE/direct-ports"

COLOURS=()
for entry in "${SITES[@]}"; do
    COLOURS+=("${entry%% *}-blue" "${entry%% *}-green")
done

# What this repository owns, as path in the checkout:where it runs. The systemd units
# aren't listed because installing them needs sudo.
SYNCED=(
    "ops/deploy/rpi/update.sh:$BASE/update.sh"
    "ops/deploy/rpi/compose.yml:$COMPOSE"
    "ops/deploy/rpi/Dockerfile.docs:$BASE/local/Dockerfile.docs"
    "ops/deploy/rpi/Caddyfile:$PROXY/Caddyfile"
)

mkdir -p "$STATE" "$PROXY/live"

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

# Prints how many times in a row this key failed, if it's still waiting out the delay.
backing_off() {
    local file="$1" key="$2"
    local failed attempts next_try

    [[ -f "$file" ]] || return 1
    read -r failed attempts next_try < "$file"
    [[ "$failed" == "$key" ]] && (( $(date +%s) < next_try )) && echo "$attempts"
}

# Records a failure for this key and prints how many in a row that makes.
back_off() {
    local file="$1" key="$2"
    local failed="" attempts=0 next_try=0

    [[ -f "$file" ]] && read -r failed attempts next_try < "$file"
    [[ "$failed" == "$key" ]] || attempts=0
    attempts=$((attempts + 1))

    printf '%s %s %s\n' "$key" "$attempts" "$(( $(date +%s) + $(retry_delay "$attempts") ))" \
        > "$file"
    echo "$attempts"
}

# A broken update.sh can't deliver its own fix, so a file that fails this is never installed.
valid() {
    local out

    case "$1" in
        "$BASE/update.sh") bash -n "$2" ;;
        "$COMPOSE") docker compose -f "$2" config -q ;;
        "$PROXY/Caddyfile")
            out="$(docker run --rm --network none -v "$2:/Caddyfile:ro" \
                "$(docker compose -f "$COMPOSE" config --images proxy)" \
                caddy validate --config /Caddyfile --adapter caddyfile 2>&1)" \
                || { tail -n 3 <<< "$out"; return 1; }
            ;;
        *) return 0 ;;
    esac
}

# 0 if the compose file has the service, 1 if it doesn't, 2 if compose can't read the file.
file_has_service() {
    local services

    services="$(docker compose --project-directory "$BASE" -f "$1" config --services 2>/dev/null)" \
        || return 2
    grep -qx "$2" <<< "$services"
}

# Ids of this project's containers for the given services, including services compose.yml
# no longer has. The first argument is `all`, `running`, or `up` for running or restarting.
container_ids() {
    local which="$1"
    shift
    local flags=(-a)

    [[ "$which" == running ]] && flags=(--status running)
    [[ "$which" == up ]] && flags=(--status running --status restarting)

    docker compose -f "$COMPOSE" ps "${flags[@]}" --format '{{.Service}} {{.ID}}' 2>/dev/null \
        | awk -v want=" $* " 'index(want, " " $1 " ") { print $2 }'
}

running() {
    [[ -n "$(container_ids running "$1")" ]]
}

# True when the sites hold 8080-8084 themselves, the way they did before the proxy.
on_direct_ports() {
    ! running proxy && (( $(container_ids running "${DIRECT[@]}" | wc -l) == ${#DIRECT[@]} ))
}

stop_services() {
    local ids

    read -r -d '' -a ids <<< "$(container_ids up "$@")"
    (( ${#ids[@]} == 0 )) || docker stop "${ids[@]}" >/dev/null 2>&1 || true
}

site_info() {
    local entry

    for entry in "${SITES[@]}"; do
        if [[ "${entry%% *}" == "$1" ]]; then
            echo "${entry#* }"
            return 0
        fi
    done

    return 1
}

# The colour Caddy sends a site to, from the file it reads on every request.
live_colour() {
    sed -n "s/^$1-\([a-z]*\)$/\1/p" "$PROXY/live/$1" 2>/dev/null
}

# Renamed into place, so Caddy reads either the old file or the new one, never half of one.
set_live() {
    printf '%s-%s\n' "$1" "$2" > "$PROXY/live/$1.incoming"
    mv "$PROXY/live/$1.incoming" "$PROXY/live/$1"
}

other_colour() {
    if [[ "$1" == blue ]]; then
        echo green
    else
        echo blue
    fi
}

# After an image load the Pi's USB stick has minutes of writing to catch up on, and creating
# a container waits behind it. This does the waiting up front, where the log can say so.
flush_writes() {
    local started=$SECONDS

    sync -f "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)" 2>/dev/null || sync
    echo "[$(date -Is)] [$1] disk writes caught up in $((SECONDS - started))s"
}

# Waits for a container's healthcheck. If it doesn't pass, the log says why.
wait_ready() {
    local site="$1" service="$2" id="$3"
    local started=$SECONDS status health

    while :; do
        read -r status health < <(docker inspect "$id" \
            --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
            2>/dev/null)

        if [[ "$health" == healthy || ( "$health" == none && "$status" == running ) ]]; then
            echo "[$(date -Is)] [$site] $service ready after $((SECONDS - started))s"
            return 0
        fi

        if [[ "$status" != running ]]; then
            echo "[$(date -Is)] [$site] $service is ${status:-gone}. Its last lines:"
            docker logs --tail 10 "$id" 2>&1 | sed 's/^/    /'
            return 1
        fi

        if (( SECONDS - started >= READY_TIMEOUT )); then
            echo "[$(date -Is)] [$site] $service still $health after ${READY_TIMEOUT}s. Last check:" \
                "$(docker inspect "$id" --format \
                    '{{if .State.Health}}{{range .State.Health.Log}}{{.ExitCode}} {{json .Output}}{{"\n"}}{{end}}{{end}}' \
                    | grep -v '^$' | tail -n 1)"
            return 1
        fi

        sleep 2
    done
}

# Recreates a colour from the image its tag points at, and waits for it.
start_colour() {
    local site="$1" service="$1-$2"

    if ! docker compose -f "$COMPOSE" up -d --no-deps --no-build --force-recreate "$service"; then
        echo "[$(date -Is)] [$site] $service didn't start"
        return 1
    fi

    wait_ready "$site" "$service" "$(container_ids all "$service")"
}

# A tag points at the newest build or pull, whether or not it went live. This points it at the
# image a container has, so nothing else gets created from a build that failed.
retag_from() {
    local site="$1" id="$2" file="${3:-$COMPOSE}" service="${4:-$1-blue}"
    local image

    image="$(docker inspect "$id" --format '{{.Image}}' 2>/dev/null)" || return 0
    docker tag "$image" \
        "$(docker compose --project-directory "$BASE" -f "$file" config --images "$service")"
}

retag_live() {
    retag_from "$1" "$(container_ids all "$1-$(live_colour "$1")")" "${@:2}"
}

# Starts the colour that isn't live and moves Caddy to it once it's healthy. Until then the
# live one keeps serving, and a new one that fails is stopped again.
swap() {
    local site="$1"
    local live next port target path out

    live="$(live_colour "$site")"
    next="$(other_colour "$live")"
    read -r port target path < <(site_info "$site")

    echo "[$(date -Is)] [$site] starting $site-$next${live:+ next to $site-$live}"

    if ! start_colour "$site" "$next"; then
        stop_services "$site-$next"
        retag_live "$site"
        echo "[$(date -Is)] [$site] stopped $site-$next again${live:+; $site-$live is still live}"
        return 1
    fi

    if ! out="$(docker compose -f "$COMPOSE" exec -T proxy \
        wget -q -O /dev/null -T 10 "http://$site-$next:$target$path" 2>&1)"; then
        stop_services "$site-$next"
        retag_live "$site"
        echo "[$(date -Is)] [$site] Caddy can't reach $site-$next ($out)${live:+; $site-$live is still live}"
        return 1
    fi

    set_live "$site" "$next"

    if ! answers "$port" "$path"; then
        [[ -n "$live" ]] && set_live "$site" "$live"
        stop_services "$site-$next"
        retag_live "$site"
        echo "[$(date -Is)] [$site] $site-$next didn't answer on $port through Caddy${live:+; $site-$live is live again}"
        return 1
    fi

    echo "[$(date -Is)] [$site] live on $site-$next"

    if [[ -n "$live" ]]; then
        sleep "$DRAIN"
        stop_services "$site-$live"
    fi
}

# Stops one set of containers and starts another on the same ports, which are closed in
# between. If any of the second set doesn't start, the first set is started again.
handover() {
    local from to id pids=() failed=0

    read -r -d '' -a from <<< "$1"
    read -r -d '' -a to <<< "$2"
    (( ${#to[@]} > 0 )) || return 1

    (( ${#from[@]} == 0 )) || docker stop -t 1 "${from[@]}" >/dev/null 2>&1

    for id in "${to[@]}"; do
        docker start "$id" >/dev/null &
        pids+=("$!")
    done

    for id in "${pids[@]}"; do
        wait "$id" || failed=1
    done

    (( failed == 0 )) && return 0

    docker stop -t 1 "${to[@]}" >/dev/null 2>&1
    (( ${#from[@]} == 0 )) || docker start "${from[@]}" >/dev/null
    return 1
}

# Asks through the published port, the way the tunnel does, for up to 30s.
answers() {
    local port="$1" path="$2"
    local published code deadline=$((SECONDS + 30))

    published="$(docker compose -f "$COMPOSE" port proxy "$port" 2>/dev/null)"

    while (( SECONDS < deadline )); do
        code="$( {
            exec 3<>"/dev/tcp/127.0.0.1/${published##*:}" \
                && printf 'GET %s HTTP/1.0\r\nHost: localhost\r\n\r\n' "$path" >&3 \
                && read -r -t 10 _ code _ <&3 \
                && echo "$code"
        } 2>/dev/null )"

        [[ "$code" == [23]* ]] && return 0
        sleep 1
    done

    return 1
}

pause_deploys() {
    echo "[$(date -Is)] [proxy] $1"
    echo "[$(date -Is)] [proxy] not deploying until $DIRECT_MARKER is removed"
    date -Is > "$DIRECT_MARKER"
}

# Puts Caddy on 8080-8084. Whatever held the ports keeps them until every site is healthy
# behind Caddy.
to_proxy() {
    local entry site port path colour id ok direct proxy attempts

    echo
    echo "[$(date -Is)] [proxy] not running; moving 8080-8084 to it"

    if attempts="$(backing_off "$STATE/proxy.failed" proxy)"; then
        echo "[$(date -Is)] [proxy] failed ${attempts}x in a row; retry later"
        return 1
    fi

    if [[ ! -f "$PROXY/Caddyfile" ]]; then
        echo "[$(date -Is)] [proxy] $PROXY/Caddyfile isn't installed; nothing changed"
        return 1
    fi

    direct="$(container_ids running "${DIRECT[@]}")"

    for entry in "${SITES[@]}"; do
        read -r site _ <<< "$entry"
        colour="$(live_colour "$site")"
        colour="${colour:-blue}"
        id="$(container_ids all "$site-$colour")"

        ok=0

        # From the sites' own containers, a colour gets the image that's serving. Otherwise a
        # colour that exists is started as it is, because its tag may point at a failed build.
        if [[ -n "$direct" ]]; then
            retag_from "$site" "$(container_ids running "$site")"
            start_colour "$site" "$colour" && ok=1
        elif [[ -n "$id" ]]; then
            docker start "$id" >/dev/null && wait_ready "$site" "$site-$colour" "$id" && ok=1
        elif build_args "$site" >/dev/null && ! docker image inspect \
            "$(docker compose -f "$COMPOSE" config --images "$site-$colour")" >/dev/null 2>&1; then
            echo "[$(date -Is)] [$site] no image yet; it goes live after its first build"
            continue
        else
            start_colour "$site" "$colour" && ok=1
        fi

        if (( ok )); then
            set_live "$site" "$colour"
            continue
        fi

        stop_services "$site-$colour"

        if running "$site"; then
            attempts="$(back_off "$STATE/proxy.failed" proxy)"
            echo "[$(date -Is)] [proxy] $site-$colour isn't healthy (${attempts}x in a row); the old containers keep 8080-8084"
            return 1
        fi

        echo "[$(date -Is)] [proxy] $site-$colour isn't healthy; starting Caddy without it"
    done

    if ! docker compose -f "$COMPOSE" up --no-start --no-deps proxy; then
        attempts="$(back_off "$STATE/proxy.failed" proxy)"
        echo "[$(date -Is)] [proxy] couldn't create it (${attempts}x in a row); nothing else changed"
        return 1
    fi

    proxy="$(container_ids all proxy)"
    flush_writes proxy

    if ! handover "$(container_ids up "${DIRECT[@]}")" "$proxy"; then
        if [[ -n "$direct" ]]; then
            pause_deploys "Caddy didn't start, so the old containers are back on 8080-8084"
        else
            attempts="$(back_off "$STATE/proxy.failed" proxy)"
            echo "[$(date -Is)] [proxy] Caddy didn't start (${attempts}x in a row)"
        fi
        return 1
    fi

    for entry in "${SITES[@]}"; do
        read -r site port _ path <<< "$entry"
        running "$site-$(live_colour "$site")" || continue
        answers "$port" "$path" && continue

        if [[ -n "$direct" ]]; then
            handover "$proxy" "$(container_ids all "${DIRECT[@]}")"
            pause_deploys "$site didn't answer through Caddy on $port, so the old containers are back"
        else
            echo "[$(date -Is)] [proxy] $site doesn't answer through Caddy on $port"
        fi
        return 1
    done

    rm -f "$STATE/proxy.failed"
    echo "[$(date -Is)] [proxy] serving 8080-8084"
}

# Puts the sites back on 8080-8084 themselves, recreated from their current images with a
# compose file that has no proxy. If they don't start, Caddy is started again.
to_direct() {
    local file="$1"
    local entry proxy direct

    for entry in "${SITES[@]}"; do
        retag_live "${entry%% *}" "$file" "${entry%% *}"
    done

    if ! docker compose --project-directory "$BASE" -f "$file" \
        up --no-start --no-build "${DIRECT[@]}"; then
        echo "[$(date -Is)] [proxy] couldn't create the old containers; nothing changed"
        return 1
    fi

    direct="$(container_ids all "${DIRECT[@]}")"
    proxy="$(container_ids running proxy)"
    flush_writes proxy

    if ! handover "$proxy" "$direct"; then
        echo "[$(date -Is)] [proxy] the old containers didn't start${proxy:+; Caddy is serving again}"
        return 1
    fi

    stop_services "${COLOURS[@]}"
    echo "[$(date -Is)] [proxy] the sites are on 8080-8084 themselves"
}

# The newest compose.yml in the checkout's history that has no proxy.
direct_compose() {
    local rev content

    while read -r rev; do
        content="$(git -C "$BASE" show "$rev:ops/deploy/rpi/compose.yml" 2>/dev/null)" || continue
        grep -q '^  proxy:$' <<< "$content" && continue
        printf '%s\n' "$content"
        return 0
    done < <(git -C "$BASE" rev-list HEAD -- ops/deploy/rpi/compose.yml)

    return 1
}

# `update.sh direct`, for when Caddy is the problem.
direct_ports() {
    local file="$STATE/direct-compose.yml"

    if ! direct_compose > "$file" || (( $(file_has_service "$file" site; echo $?) != 0 )); then
        echo "There's no compose.yml without the proxy in the history of $BASE."
        return 1
    fi

    date -Is > "$DIRECT_MARKER"

    if ! to_direct "$file"; then
        rm -f "$DIRECT_MARKER"
        return 1
    fi

    echo "Deploys are paused until $DIRECT_MARKER is removed."
}

settings_changed() {
    local want have

    want="$(docker compose -f "$COMPOSE" config --hash "$1" 2>/dev/null | awk '{ print $2 }')"
    have="$(docker inspect "$(container_ids all "$1")" \
        --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' 2>/dev/null)"
    [[ "$want" != "$have" ]]
}

# Brings the running containers in line with a changed compose.yml. A site is swapped like a
# new build. A change to the proxy itself recreates it, which closes the ports for a moment.
apply_compose() {
    local entry site live rc=0

    file_has_service "$COMPOSE" proxy && running proxy && [[ ! -e "$DIRECT_MARKER" ]] || return 0

    if settings_changed proxy; then
        echo "[$(date -Is)] [proxy] compose.yml changed its settings; recreating it"
        docker compose -f "$COMPOSE" pull --quiet proxy
        flush_writes proxy
        docker compose -f "$COMPOSE" up -d --no-deps --no-build proxy || rc=1
    fi

    for entry in "${SITES[@]}"; do
        site="${entry%% *}"
        live="$(live_colour "$site")"
        [[ -n "$live" ]] && running "$site-$live" && settings_changed "$site-$live" || continue

        echo "[$(date -Is)] [$site] compose.yml changed its settings"
        swap "$site" || rc=1
    done

    return "$rc"
}

update_config() {
    local dirty head target pair src dest out
    local changed=0 compose_changed=0 caddyfile_changed=0 rc=0

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

    # The proxy was reverted. The sites get their ports back before the old update.sh is
    # installed, so if that fails, this one tries again on the next run.
    file_has_service "$BASE/ops/deploy/rpi/compose.yml" proxy
    if (( $? == 1 )) && ! on_direct_ports; then
        echo "[$(date -Is)] [proxy] ops/deploy/rpi/compose.yml has no proxy; moving 8080-8084 back to the sites"

        if ! to_direct "$BASE/ops/deploy/rpi/compose.yml"; then
            echo "[$(date -Is)] [config] not installing ${target:0:12} until the sites have 8080-8084 back"
            return 1
        fi
    fi

    for pair in "${SYNCED[@]}"; do
        src="$BASE/${pair%%:*}"
        dest="${pair#*:}"

        [[ -e "$src" ]] || continue
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
            "$PROXY/Caddyfile") caddyfile_changed=1 ;;
        esac
    done

    if (( compose_changed )) && ! apply_compose; then
        echo "[$(date -Is)] [config] compose.yml changed but applying it failed"
        rc=1
    fi

    # A reload can drop the odd connection that arrives within a millisecond or two of it,
    # which is why a deploy switches sites through live/ instead.
    if (( caddyfile_changed )) && running proxy && [[ ! -e "$DIRECT_MARKER" ]] \
        && ! out="$(docker compose -f "$COMPOSE" exec -T proxy \
            caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)"; then
        echo "[$(date -Is)] [config] Caddyfile changed but the reload failed: $out"
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
    timeout "$BUILD_TIMEOUT" docker compose -f "$COMPOSE" build "$service-blue" || status_code=$?
    return "$status_code"
}

update_service() {
    local repo="$1"
    local service="$2"

    local dir="$BASE/$repo"
    local statefile="$STATE/$repo.sha"
    local failedfile="$STATE/$repo.failed"
    local rebuildfile="$STATE/$repo.rebuild"

    local head target deployed dirty attempts

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

    if attempts="$(backing_off "$failedfile" "$target")"; then
        echo "[$(date -Is)] [$service] ${target:0:12} previously failed ${attempts}x; retry later"
        return 1
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
        back_off "$failedfile" "$target" >/dev/null

        # 124 is `timeout`'s own exit code. A build that fails is usually the source, and
        # one that hangs is usually the box.
        if (( status_code == 124 )); then
            echo "[$(date -Is)] [$service] BUILD TIMED OUT after $BUILD_TIMEOUT; running container untouched"
        else
            echo "[$(date -Is)] [$service] BUILD FAILED; running container untouched"
        fi
        return 1
    fi

    flush_writes "$service"

    if ! swap "$service"; then
        attempts="$(back_off "$failedfile" "$target")"
        echo "[$(date -Is)] [$service] DEPLOY FAILED (${attempts}x in a row); the last build is still live"
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
    local failedfile="$STATE/$service.failed"

    local live image before after attempts

    echo
    echo "[$(date -Is)] [$service] checking"

    live="$(live_colour "$service")"
    image="$(docker compose -f "$COMPOSE" config --images "$service-blue")"
    before="$(docker inspect "$(container_ids running "$service-${live:-blue}")" \
        --format '{{.Image}}' 2>/dev/null)"

    if ! docker pull --quiet "$image" >/dev/null; then
        echo "[$(date -Is)] [$service] pull of $image failed; running container untouched"
        return 1
    fi

    after="$(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null)"

    if [[ "$before" == "$after" ]]; then
        echo "[$(date -Is)] [$service] current ${after:7:12}"
        return 0
    fi

    if attempts="$(backing_off "$failedfile" "$after")"; then
        echo "[$(date -Is)] [$service] ${after:7:12} previously failed ${attempts}x; retry later"
        return 1
    fi

    echo "[$(date -Is)] [$service] image ${before:7:12} -> ${after:7:12}"
    flush_writes "$service"

    if ! swap "$service"; then
        attempts="$(back_off "$failedfile" "$after")"
        echo "[$(date -Is)] [$service] DEPLOY FAILED (${attempts}x in a row); the last image is still live"
        return 1
    fi

    rm -f "$failedfile"
    echo "[$(date -Is)] [$service] deployed ${after:7:12}"
}

# Extra protection against overlapping builds.
exec 9>"$BASE/.update.lock"

case "${1:-}" in
    "")
        flock -n 9 || {
            echo "[$(date -Is)] updater already running; skipping"
            exit 0
        }
        ;;
    direct)
        if ! flock -n 9; then
            echo "Waiting for the update that's running to finish..."
            flock 9
        fi
        direct_ports
        exit
        ;;
    *)
        echo "usage: update.sh [direct]" >&2
        exit 2
        ;;
esac

status=0

# First, so a merged compose.yml or Dockerfile.docs is in place before anything builds.
update_config || status=1

file_has_service "$COMPOSE" proxy
case $? in
    0) ;;
    1)
        # Reverted: update_config gave the sites their ports back, and the old update.sh runs
        # from the next start.
        if (( $(file_has_service "$BASE/ops/deploy/rpi/compose.yml" proxy; echo $?) == 0 )); then
            echo "[$(date -Is)] [proxy] compose.yml with the proxy isn't installed; not deploying"
            exit 1
        fi

        rm -f "$DIRECT_MARKER"
        stop_services "${COLOURS[@]}"
        exit "$status"
        ;;
    *)
        echo "[$(date -Is)] [config] docker compose can't read $COMPOSE; not deploying"
        exit 1
        ;;
esac

if [[ -e "$DIRECT_MARKER" ]]; then
    echo
    echo "[$(date -Is)] [proxy] sites on 8080-8084 themselves since $(cat "$DIRECT_MARKER"); not deploying"
    exit "$status"
fi

if ! running proxy; then
    to_proxy || exit 1

    # A compose.yml that changed while Caddy was down applies now.
    apply_compose || status=1
fi

# Deliberately serial. Never two builds at once.
update_service site site || status=1
update_service docs docs || status=1
update_service ui ui || status=1

update_image app || status=1
update_image beta || status=1

exit "$status"
