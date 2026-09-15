# The Raspberry Pi that serves the web

`gryt.chat`, `get.gryt.chat`, `docs.gryt.chat`, `ui.gryt.chat`, `app.gryt.chat`
and `beta.gryt.chat` all come from one Raspberry Pi (`ssh rpi`, 192.168.50.182).
The site, docs and ui images are built on Unraid (`ssh unraid`, Astro,
192.168.50.168) and loaded onto the Pi. The rest of Gryt runs on the dev box.

This directory is the Pi's deployment, plus the config for the builder on Unraid.

## What runs where

On the Pi, in the compose project `gryt-web`:

| Container | Port | Serves | Comes from |
|---|---|---|---|
| `gryt-site` | 8080 | gryt.chat, get.gryt.chat | built from Gryt-chat/site |
| `gryt-docs` | 8081 | docs.gryt.chat | built from Gryt-chat/docs with `Dockerfile.docs` from here |
| `gryt-app` | 8082 | app.gryt.chat | `ghcr.io/gryt-chat/client:latest` |
| `gryt-beta` | 8083 | beta.gryt.chat | `ghcr.io/gryt-chat/client:latest-beta` |
| `gryt-ui` | 8084 | ui.gryt.chat | built from Gryt-chat/ui |

The Cloudflare tunnel runs on the Pi as `cloudflared.service`, set up with a
token. The routes from hostname to port live in the Cloudflare dashboard, so no
file here has them.

AdGuard Home (the LAN's DNS) and Vaultwarden run on the same Docker daemon. They
aren't Gryt's, and nothing in this directory touches them.

Where each file here ends up:

| File | Where it runs | How it gets there |
|---|---|---|
| `update.sh` | `/home/sivert/gryt/update.sh` on the Pi | `update.sh` copies it |
| `compose.yml` | `/home/sivert/gryt/compose.yml` | `update.sh` copies it |
| `Dockerfile.docs` | `/home/sivert/gryt/local/Dockerfile.docs` | `update.sh` copies it |
| `gryt-update.service`, `gryt-update.timer` | `/etc/systemd/system/` on the Pi | by hand, with sudo |
| `buildkit/` | `/mnt/user/appdata/gryt-buildkit/` on Unraid | by hand |

The copying only starts once the Pi has been
[switched over](#switching-the-pi-over-to-this-directory). Until then the Pi
runs its own copies.

Some things stay out of git on purpose. The client certificate in
`~/.config/gryt-buildkit` on the Pi, everything under `certs/` on Unraid and the
tunnel token are secrets. The site, docs and ui clones and `.deployed/` are state
that belongs to the box.

## What a run does

`gryt-update.timer` starts `update.sh` five minutes after the last run ended.
The script takes `.update.lock` with `flock -n`, so a run that would overlap
another one exits straight away. Then it works through three steps in order.

### 1. The files in this directory

`/home/sivert/gryt` is a clone of this repository. The script fetches it and
fast-forwards to `origin/main`. Then it compares `update.sh`, `compose.yml` and
`Dockerfile.docs` with the copies that are running.

The script writes a changed file next to the old one, checks it and renames it
into place. `update.sh` has to pass `bash -n`, and `compose.yml` has to pass
`docker compose config`. A broken `update.sh` would stop every run after it,
including the one bringing the fix. So a file that fails the check stays out,
and the log says so. A new `update.sh` takes over from the next run.

When `compose.yml` changes, the script runs `docker compose up -d --no-build`
for the containers that are running. Compose recreates the ones whose settings
changed and leaves the others alone. Build settings don't count. Those apply the
next time that service builds.

When `Dockerfile.docs` changes, docs rebuilds in the same run, even if it was
backing off after a failed build.

It skips this step, and logs a line, if somebody edited a tracked file in the
checkout or the fast-forward fails. The rest of the run carries on.

### 2. site, docs and ui

Each one has its own clone in `/home/sivert/gryt`, and each follows its own
repository's `main`. So a merged site PR deploys without waiting for a
gitlink bump in the superproject.

For each, the script fetches and refuses anything that isn't a clean
fast-forward. Then it builds the image (see [the builder](#the-builder-on-unraid))
and runs `docker compose up -d --no-deps` for that one service.
`.deployed/<name>.sha` gets the commit once the container is up.

A failed build leaves the running container alone and backs off: 5 minutes, then
10, 20 and 40, up to six hours for the same commit.

A build that runs for 40 minutes is killed and counts as a failed one, so the
services after it still get their turn. On 2026-09-07 a `bun install` wedged
with nothing to stop it. It held the lock for 1h45m, and site and docs weren't
checked once in that time. `TimeoutStartSec=2h` on the unit covers a hang
anywhere else.

### 3. app and beta

These are images, so there's no commit to compare. The script pulls the tag and
recreates the container when the image id under it has changed.

### Reading the log

The log keeps a failed build apart from one that timed out. A failure is usually
in the source, and a timeout is usually the machine.

```
[…] [config] local/Dockerfile.docs updated
[…] [config] deployed 06d30f4df74b
[…] [docs] building on gryt-unraid
[…] [docs] BUILD TIMED OUT after 40m; running container untouched
[…] [docs] BUILD FAILED; running container untouched
[…] [app] image 962b75da1f75 -> e2d59aec8237
```

## The builder on Unraid

The Pi used to build all three images itself. A site build there took 15 minutes
when GRYT-833 measured it, and on 2026-09-15 site and docs both ran past the
40-minute timeout. Since GRYT-1204 the builds run on Unraid, where all three took
about 16 minutes together.

- On Unraid, `gryt-buildkit` is a rootless `moby/buildkit` container, published
  on 192.168.50.168:1234 and nowhere else. It gets 12 CPUs and 16 GB, and keeps
  up to 40 GB of cache in the `gryt-buildkit-cache` volume.
- It only accepts clients with a certificate signed by its own CA.
  `buildkit/gen-certs.sh` makes the CA, the daemon's certificate and one client
  certificate for the Pi. All of them are valid until September 2036, and the CA
  key never leaves Unraid.
- On the Pi, `gryt-unraid` is a buildx builder on the remote driver. It points at
  that address and uses the client certificate from `~/.config/gryt-buildkit`.

`update.sh` gives the builder 20 seconds to answer
`docker buildx inspect --bootstrap`. Then:

- If it answers, the image is built there for `linux/arm64` and loaded into the
  Pi's Docker under the tag `compose.yml` expects. The script calls
  `docker buildx build` itself, because `docker compose build` asks for
  `network: host` and the daemon refuses it.
- If it doesn't answer, the build runs on the Pi with `docker compose build`,
  the way every build used to. That still works, but it can take long enough to
  hit the timeout.
- If a remote build fails and the builder still answers, that's a real failure
  and it goes on the backoff. Retrying on the Pi would only fail again an hour
  later.
- If a remote build fails and the builder has gone, the build is retried on the
  Pi.
- If a remote build times out, it isn't retried on the Pi.

An expired or replaced certificate looks the same as Unraid being off. The log
says `gryt-unraid unreachable; building locally`.

### Every RUN goes in a stage on the build platform

Unraid can't run arm64 binaries. So the Dockerfiles for all three do their work
in stages marked `--platform=$BUILDPLATFORM`, and the final arm64 stage only
copies files in. A `RUN` in that final stage fails on Unraid. The builder is
still up when that happens, so the service goes on the backoff and never falls
back to building on the Pi. This goes for site's and ui's own Dockerfiles, and
for `Dockerfile.docs` here.

`Dockerfile.docs` is the docs repository's Dockerfile with three changes. The
build stage runs on `$BUILDPLATFORM`. A step swaps sharp's native module for the
target's musl build. And yarn gets a ten-minute network timeout with one
connection at a time.

## Switching the Pi over to this directory

This is a one-time step for Sivert. Until it runs, the Pi uses its own
`update.sh`, `compose.yml` and `local/Dockerfile.docs`. Its checkout of this
repository is still on a commit from 2026-09-08, because nothing pulls it.

The command below fast-forwards that checkout and renames this directory's
`update.sh` into place. It doesn't stop anything or need sudo. The timer keeps
its schedule, and a run that's already going finishes on the old script. Then
the command waits for the next run and prints what it synced. Ctrl-C during the
wait is safe.

```bash
ssh rpi 'set -e
cd /home/sivert/gryt
git fetch --quiet origin main
git merge --ff-only --quiet origin/main
grep -q update_config ops/deploy/rpi/update.sh
rm -f update.sh.incoming
cp ops/deploy/rpi/update.sh update.sh.incoming
chmod 755 update.sh.incoming
bash -n update.sh.incoming
mv update.sh.incoming update.sh
since=$(date "+%F %T")
echo "update.sh is the repository copy now. Waiting for the next run..."
for i in $(seq 100); do
  log=$(journalctl -u gryt-update.service --since "$since" --no-pager -o cat | grep -F "[config]" || true)
  if echo "$log" | grep -qE "current|deployed|skipping|not installed|failed"; then echo "$log"; exit 0; fi
  sleep 15
done
echo "No run has got that far yet. journalctl -u gryt-update.service -n 40 shows where it is."'
```

If a step before the `mv` fails, `set -e` stops there and the running script
isn't touched. The `grep` refuses an `update.sh` that doesn't have the copying
step yet.

The first run should print `local/Dockerfile.docs updated`, then `deployed`.
The repository's `Dockerfile.docs` only differs from the Pi's in its comments.
That still counts as a change, so docs rebuilds once, mostly from cache.

The units don't need installing for this. The ones on the Pi match the ones here
byte for byte.

## Installing from scratch

### Unraid

From a checkout of this repository:

```bash
ssh unraid 'mkdir -p /mnt/user/appdata/gryt-buildkit'
scp ops/deploy/rpi/buildkit/compose.yml ops/deploy/rpi/buildkit/buildkitd.toml \
  ops/deploy/rpi/buildkit/gen-certs.sh unraid:/mnt/user/appdata/gryt-buildkit/
ssh unraid 'cd /mnt/user/appdata/gryt-buildkit && chmod +x gen-certs.sh \
  && ./gen-certs.sh && docker compose -p gryt-buildkit up -d'
```

`gen-certs.sh` won't run if `certs/ca.key` already exists. A new CA would lock
the Pi out, and its log would only say the builder is unreachable.

### The Pi

It needs Docker with the compose and buildx plugins, git, and `sivert` in the
`docker` group. Clone this repository and the three sites, put the files in
place and start the two client containers:

```bash
ssh rpi 'set -e
git clone https://github.com/Gryt-chat/gryt.git /home/sivert/gryt
cd /home/sivert/gryt
for r in site docs ui; do git clone --depth 1 "https://github.com/Gryt-chat/$r.git" "$r"; done
cp ops/deploy/rpi/update.sh ops/deploy/rpi/compose.yml .
chmod 755 update.sh
mkdir -p local
cp ops/deploy/rpi/Dockerfile.docs local/
docker compose -f compose.yml up -d app beta'
```

Copy the client certificate from Unraid to the Pi. It goes through a pipe and is
never written to disk on the machine in between:

```bash
ssh unraid 'tar -C /mnt/user/appdata/gryt-buildkit/certs/client -cf - ca.pem cert.pem key.pem' \
  | ssh rpi 'install -d -m 700 /home/sivert/.config/gryt-buildkit \
    && tar -C /home/sivert/.config/gryt-buildkit -xf - \
    && chmod 600 /home/sivert/.config/gryt-buildkit/*.pem'
```

Register the builder and check that it answers:

```bash
ssh rpi 'docker buildx create --name gryt-unraid --driver remote \
  --driver-opt cacert=/home/sivert/.config/gryt-buildkit/ca.pem,cert=/home/sivert/.config/gryt-buildkit/cert.pem,key=/home/sivert/.config/gryt-buildkit/key.pem,servername=192.168.50.168 \
  tcp://192.168.50.168:1234 \
  && docker buildx inspect --bootstrap gryt-unraid | grep Status'
```

Then the units. This is the only step that needs sudo, so it asks for a password.
It's also how a changed unit file gets onto the Pi later:

```bash
ssh -t rpi 'sudo install -m 644 /home/sivert/gryt/ops/deploy/rpi/gryt-update.service \
    /home/sivert/gryt/ops/deploy/rpi/gryt-update.timer /etc/systemd/system/ \
  && sudo systemctl daemon-reload \
  && sudo systemctl enable --now gryt-update.timer'
```

`.deployed/` starts out empty, so the first run builds site, docs and ui.

The tunnel isn't covered here. It's `cloudflared` with a token from the
Cloudflare dashboard, routing each hostname to its port from the table at the
top.

### Replacing the certificates

They're valid until September 2036. To replace them sooner, this moves the old
ones aside, makes new ones, restarts the builder and copies the new client
certificate to the Pi. Builds fall back to the Pi for the short time in between.

```bash
ssh unraid 'set -e; cd /mnt/user/appdata/gryt-buildkit; mv certs "certs.old-$(date +%F)"; ./gen-certs.sh; docker compose -p gryt-buildkit up -d --force-recreate' \
  && ssh unraid 'tar -C /mnt/user/appdata/gryt-buildkit/certs/client -cf - ca.pem cert.pem key.pem' \
  | ssh rpi 'tar -C /home/sivert/.config/gryt-buildkit -xf - && chmod 600 /home/sivert/.config/gryt-buildkit/*.pem'
```

Restarting the builder fails any build running on it at that moment, and that
build is tried again on a later run.

## Checking on it

```bash
ssh rpi 'systemctl list-timers gryt-update.timer --no-pager'
ssh rpi 'journalctl -u gryt-update.service -n 60 --no-pager -o cat'
ssh rpi 'docker buildx inspect --bootstrap gryt-unraid | grep Status'
ssh unraid 'docker ps --filter name=gryt-buildkit'
```

`sivert` is in the `adm` group on the Pi, so the journal reads without sudo.

## Before touching it

- **Make changes in this directory.** Once the Pi is switched over, a hand edit
  on the Pi to `update.sh`, `compose.yml` or `local/Dockerfile.docs` gets
  overwritten on the next run. A hand edit inside the checkout, under
  `/home/sivert/gryt/ops/`, stops step 1 until it's undone, and the log says
  `local tracked changes present`.
- **Don't run `docker system prune` on the Pi.** AdGuard and Vaultwarden share
  its Docker daemon, and the local fallback build needs the build cache.
- **A failed build leaves the site up.** The running container stays on the last
  good build, on purpose.
- **`.deployed/<name>.sha` is what's deployed.** A clone can be ahead of it when
  a build failed after the fast-forward.
- **The checkout's submodules aren't initialised.** Nothing under `packages/` is
  used on the Pi. The sites come from the three clones.
