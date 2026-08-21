## ops/internal

This folder contains **internal** infrastructure used to run:

- `gryt.chat` (marketing site)
- `docs.gryt.chat` (documentation)
- `ui.gryt.chat` (the `@gryt/ui` component library docs)
- `feedback.gryt.chat` (Fider feature requests board)

It’s **not** intended for self-hosters. Self-hosting docs live under `ops/deploy/*` (Docker Compose) and `ops/helm/*` (Kubernetes).

## Start (site + docs)

From the repo root:

```bash
cp ops/internal/.env.example ops/internal/.env
docker compose --env-file ops/internal/.env -f ops/internal/docker-compose.yml up -d --build
```

## Ports

You must use unique host ports. Configure them in `ops/internal/.env`:

- `INTERNAL_SITE_HTTP_PORT` (default `9472`)
- `INTERNAL_DOCS_HTTP_PORT` (default `9471`)
- `INTERNAL_UI_HTTP_PORT` (default `9475`)
- `FIDER_HTTP_PORT` (default `9473`)

## Fider auth: use Gryt Auth (Keycloak OIDC)

Fider supports any OAuth2 provider. To use **Gryt Auth** (`auth.gryt.chat`), configure Keycloak as the provider.

### 1) Create a Keycloak client for Fider

In Keycloak (`gryt` realm):

- **Client ID**: `fider`
- **Client type**: OpenID Connect
- **Client authentication**: On (confidential)
- **Standard flow**: On
- **Valid redirect URIs**: `https://feedback.gryt.chat/oauth/*/callback`
- **Web origins**: `https://feedback.gryt.chat`

Copy the generated **client secret**.

### 2) Add Keycloak as an OAuth provider in Fider

In Fider (admin): **Site Settings → Authentication → Add New**

- **Authorize URL**: `https://auth.gryt.chat/realms/gryt/protocol/openid-connect/auth`
- **Token URL**: `https://auth.gryt.chat/realms/gryt/protocol/openid-connect/token`
- **Profile API URL**: `https://auth.gryt.chat/realms/gryt/protocol/openid-connect/userinfo`
- **Scope**: `openid profile email`
- **Client ID**: `fider`
- **Client Secret**: (from step 1)
- **JSON Path ID**: `sub`
- **JSON Path Email**: `email`
- **JSON Path Name**: `preferred_username` (or `name`)

Use Fider’s **Test** button before enabling the provider.

## Cloudflared (what to forward)

- `gryt.chat` → `http://127.0.0.1:<INTERNAL_SITE_HTTP_PORT>`
- `docs.gryt.chat` → `http://127.0.0.1:<INTERNAL_DOCS_HTTP_PORT>`
- `ui.gryt.chat` → `http://127.0.0.1:<INTERNAL_UI_HTTP_PORT>`
- `feedback.gryt.chat` → `http://127.0.0.1:<FIDER_HTTP_PORT>`

All four should be **proxied** and routed through the same Cloudflare Tunnel.

## Downloads folder

Static files placed in `ops/internal/downloads/` are served at `/downloads/*` on `gryt.chat`.

## Keeping the hosted web clients current

`app.gryt.chat` and `beta.gryt.chat` are not built from source like the sites above. They
are the `ghcr.io/gryt-chat/client` image that `Release Client` pushes on every release,
running as the `client` service of the `gryt-prod` and `gryt-beta` stacks in
`ops/deploy/compose/`.

Building and pushing that image was automated. Pulling it was not, so the web client only
moved when somebody remembered. On 2026-08-17 `app.gryt.chat` was serving **1.5.6** against
a desktop app on **1.6.15-beta.1** — ten releases, including the whole seed-derived guest
identity feature set, which read from the outside as "that only works on desktop"
(GRYT-291).

[`refresh-web-client.sh`](refresh-web-client.sh) closes that. It pulls `latest` for prod and
`latest-beta` for beta, and recreates the container only when the image id actually moved:

```bash
ops/internal/refresh-web-client.sh
```

It touches nothing but the `client` service — `--no-deps`, one service named, never a bare
`up -d` — so the server, the SFU, the image worker and MinIO are never in its way. It
refuses to run with less than 10GB free, since the auth database is on the same disk. It
only refreshes a container that is already running, and will not bring a missing one up.

Nothing in it is specific to one machine, and there are no paths to configure. Each stack's
compose files, the order they were merged in and the env file they were read with all come
off the running container's own labels. That is not a shortcut — the overlay list has to
match what the stack came up with exactly, because compose merges left to right and a
different list is a different config, which would make `up` recreate the container every
ten minutes forever. Some of those overlays are untracked and exist only on the host, so
no list committed here could be right.

Three environment variables, none of them required:

| | |
|---|---|
| `GRYT_STACKS` | stacks to refresh, space separated. Default `prod beta`; each `<s>` means the container `gryt-<s>-client` |
| `GRYT_SERVICE` | the compose service, if it is not called `client` |
| `GRYT_MIN_FREE_GB` | refuse to pull below this much free disk. Default `10` |

A release-triggered deploy would be tighter, and is not what this is: the box sits behind
the Cloudflare tunnel with no self-hosted runner, so a job in `Release Client` would need
inbound SSH and secrets before it could do anything at all. A timer needs neither.

### Installing the timer

Symlink rather than copy, so `git pull` updates the script and nothing has to be installed
twice. `ExecStart` needs a literal absolute path — systemd does not expand variables in the
executable itself — so the symlink is what keeps the unit free of anybody's home directory.

```bash
sudo ln -sfn "$PWD/ops/internal/refresh-web-client.sh" /usr/local/bin/gryt-web-client-refresh
sudo cp ops/internal/systemd/gryt-web-client-refresh.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gryt-web-client-refresh.timer
```

It fires every ten minutes and runs as root, which is the usual arrangement for a system
unit talking to the Docker socket. To run as somebody else, drop in an override with
`User=` and `SupplementaryGroups=docker` rather than editing the shipped unit.

Anything that differs per machine goes in `/etc/default/gryt-web-client-refresh` — see
[`gryt-web-client-refresh.env.example`](systemd/gryt-web-client-refresh.env.example). On a
normal checkout none of it is needed.

Check on it with `systemctl list-timers gryt-web-client-refresh`, and read what it
did with:

```bash
sudo journalctl -u gryt-web-client-refresh -n 50
```

The `sudo` is not optional. The service runs as root, and `journalctl` without it
shows only your own messages, so the plain command prints nothing at all and looks
like the timer never ran. `id -nG` will tell you whether you are in `adm` or
`systemd-journal`; on this box the answer is no.

Immediately after `enable --now`, `list-timers` shows `NEXT` and `LEFT` as `-`.
That is the first run still going, not a timer that failed to schedule: the next
elapse appears once the service goes inactive, a few seconds later.

Superseded images are left dangling rather than removed — roughly 30MB a release. Cleaning
them up stays something to do by hand, because the disk being freed is the one Keycloak
lives on.

The rest of the `gryt-prod` stack — server, SFU, image worker — is deliberately **not** in
scope. Those carry data, and rolling them forward is a decision rather than a cron job.

## Keeping the sites built from source current

`docs.gryt.chat`, `gryt.chat` and `ui.gryt.chat` have the opposite problem. They are not
images anybody pushed, they are the `build:` contexts above pointing at the `docs`, `site`
and `ui` submodules, so merging a pull request changes nothing that is running until
somebody rebuilds by hand. That is how the `@gryt/voice` documentation could merge and
`docs.gryt.chat` still not have it (GRYT-360).

[`refresh-sites.sh`](refresh-sites.sh) is the same idea as the web client refresh with a
different question to ask. There is no registry to check a digest against, so it fetches
each submodule and rebuilds the ones whose commit has moved:

```bash
ops/internal/refresh-sites.sh
```

A quiet ten minutes costs one `git fetch` per repository and nothing else. When something
has moved it fast-forwards that submodule, runs `docker compose build` for that one
service, and `up -d --no-deps` it.

What it will not do:

- It never runs a bare `up -d`. Fider and its Postgres are in the same compose file, and a
  timer has no business recreating a database.
- It leaves a submodule alone if it has tracked local modifications, rather than discarding
  them. Untracked files are ignored, since these checkouts are full of `node_modules` and
  build output and would otherwise read as permanently dirty.
- It only refreshes a container that is already running, for the same reason the web client
  script does: it does not know what a missing one was supposed to look like.
- It refuses to build below 20GB free. Higher than the web client's 10, because these run
  real builds rather than pulling a 30MB nginx image, and the disk is the one Keycloak
  lives on.

Neither the service list nor the source directories are written down in the script. The
compose files, their order and the env file come off the running container's labels, and
each service's build context comes out of the merged compose config, so moving a submodule
is not also an edit here.

The unit runs as root, which is what it needs to reach the Docker socket, but the git calls
drop to whoever owns each checkout. Git refuses to work inside a repository owned by
somebody else, and running it as root anyway would leave root-owned objects in that person's
repository the first time it fetched. Only git changes user; docker stays as root.

The one thing it does keep on the machine is what it last built, one file per service under
`/var/lib/gryt-sites-refresh`. There is no registry to ask, so the answer has to be written
down somewhere. A missing file counts as unknown rather than as current, which means the
first run after installing this rebuilds all three. That is the right answer anyway, since
the running containers are of unknown vintage until something has built them.

It also remembers what failed. A build that fails on a given commit will fail on it again,
and retrying every ten minutes forever costs real CPU for as long as the breakage lasts. So
the gap between attempts doubles from one interval up to a day, and a commit inside its gap
is skipped without building. A different commit starts the count over, and a successful
deploy clears it, so a fix is picked up on the next firing with nothing to clear by hand.

Skipping still exits non-zero. The site is on old source either way, and a unit that went
green while that was true would hide exactly what this timer exists to stop. What the
backoff saves is the build, not the red.

Seven environment variables, none of them required:

| | |
|---|---|
| `GRYT_SITES` | compose services to rebuild, space separated. Default `docs site ui` |
| `GRYT_SITES_PROJECT` | the compose project they belong to. Default `internal`, so service `docs` is the container `internal-docs-1` |
| `GRYT_SITES_BRANCH` | the branch to follow in each submodule. Default `main` |
| `GRYT_SITES_STATE` | where the commit last built is remembered. Default `/var/lib/gryt-sites-refresh` |
| `GRYT_MIN_FREE_GB` | refuse to build below this much free disk. Default `20` |
| `GRYT_RETRY_BASE_SECONDS` | first gap after a failed build, doubling from there. Default `600` |
| `GRYT_RETRY_CAP_SECONDS` | longest that gap gets. Default `86400` |

It follows each submodule's own `origin/main` rather than the gitlink the superproject
records. The gitlink lags behind `update-submodules.yml`, and none of these three sites has
any reason to wait for a superproject bump. If you want them pinned to the gitlink instead,
that is a different script rather than a flag.

### Installing the timer

```bash
sudo ln -sfn "$PWD/ops/internal/refresh-sites.sh" /usr/local/bin/gryt-sites-refresh
sudo ln -sfn "$PWD/ops/internal/pull-superproject.sh" /usr/local/bin/gryt-pull-superproject
sudo cp ops/internal/systemd/gryt-sites-refresh.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gryt-sites-refresh.timer
```

The second symlink is what keeps this checkout current. The unit runs it as an
`ExecStartPre`, so every tick fast-forwards the superproject before rebuilding
anything, and a change to `ops/` reaches the machine on its own.

It only ever fast-forwards, and never recurses into the submodules — those
belong to the refresher below, which moves them to commits the gitlinks here do
not name. A checkout with local commits or tracked changes outside `packages/`
is left alone and says so.

Same shape as the web client timer, including the symlink and the root-by-default. It fires
every ten minutes with a randomised delay offset from that one, so a build and an image pull
do not routinely land on the Docker daemon together. `TimeoutStartSec` is an hour rather
than ten minutes, because three builds from a cold layer cache take a while.

Read what it did with `sudo journalctl -u gryt-sites-refresh -n 50`. The `sudo` matters for
the same reason it does above.

The first run rebuilds all three and will take a few minutes. After that, most runs print
three `already on <commit>` lines and stop.
