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
refuses to run with less than 10GB free, since the auth database is on the same disk.

A release-triggered deploy would be tighter, and is not what this is: `dev.lan` sits behind
the Cloudflare tunnel with no self-hosted runner, so a job in `Release Client` would need
inbound SSH and secrets before it could do anything at all. A timer needs neither.

Installed as a systemd timer, firing every ten minutes:

```bash
sudo cp ops/internal/systemd/gryt-web-client-refresh.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gryt-web-client-refresh.timer
```

Check on it with `systemctl list-timers gryt-web-client-refresh` and
`journalctl -u gryt-web-client-refresh -n 50`.

Superseded images are left dangling rather than removed — roughly 30MB a release. Cleaning
them up stays something to do by hand, because the disk being freed is the one Keycloak
lives on.

The rest of the `gryt-prod` stack — server, SFU, image worker — is deliberately **not** in
scope. Those carry data, and rolling them forward is a decision rather than a cron job.
