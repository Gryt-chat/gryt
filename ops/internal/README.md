## ops/internal

This folder contains **internal** infrastructure used to run:

- `gryt.chat` (marketing site)
- `docs.gryt.chat` (documentation)
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
- `feedback.gryt.chat` → `http://127.0.0.1:<FIDER_HTTP_PORT>`

All three should be **proxied** and routed through the same Cloudflare Tunnel.

## Downloads folder

Static files placed in `ops/internal/downloads/` are served at `/downloads/*` on `gryt.chat`.
