<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt</h1>
  <p><strong>Open-source WebRTC voice chat platform</strong></p>
  <p>
    <a href="https://docs.gryt.chat"><img src="https://img.shields.io/badge/docs-docs.gryt.chat-blue" alt="Docs" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" /></a>
    <a href="https://golang.org/"><img src="https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white" alt="Go" /></a>
  </p>

  <img src="/.github/preview_client.png" width="700" alt="Gryt preview" />

  <br />

  <strong><a href="https://app.gryt.chat">Try Gryt instantly at app.gryt.chat</a></strong> — no download or setup required.
</div>

<br />

> [!CAUTION]
> **Early Development Stage** — This project is experimental and under active development. Expect breaking changes.

## Quick Start

```bash
git clone --recurse-submodules https://github.com/Gryt-chat/gryt.git
cd gryt
./ops/start_dev.sh
```

Open **http://localhost:3666** and you're in.

## Documentation

Full documentation lives at **[docs.gryt.chat](https://docs.gryt.chat)**:

- [Quick Start](https://docs.gryt.chat/docs/guide/quick-start) — prerequisites, setup, running services
- [Architecture](https://docs.gryt.chat/docs/guide/architecture) — how the pieces fit together
- [Configuration](https://docs.gryt.chat/docs/guide/configuration) — environment variables and options
- [Deployment](https://docs.gryt.chat/docs/deployment) — Docker Compose, Kubernetes, Cloudflare Tunnel
- [Troubleshooting](https://docs.gryt.chat/docs/guide/troubleshooting) — common issues and fixes
- [FAQ](https://docs.gryt.chat/docs/guide/faq)

## Self-Hosting

Host your own Gryt server with Docker Compose — connect with the desktop app:

```bash
curl -O https://raw.githubusercontent.com/Gryt-chat/gryt/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/Gryt-chat/gryt/main/.env.example
cp .env.example .env       # edit as needed
docker compose up -d
```

Download the **[Gryt desktop app](https://github.com/Gryt-chat/gryt/releases)** and connect to your server, or use the hosted web client at **[app.gryt.chat](https://app.gryt.chat)**.

Optionally run the web client too:

```bash
docker compose --profile web up -d
```

## Docker Images

Pre-built images are published to GitHub Container Registry:

| Image | Purpose | Required? |
|-------|---------|-----------|
| `ghcr.io/gryt-chat/server` | Signaling, chat, file uploads | Yes |
| `ghcr.io/gryt-chat/sfu` | WebRTC media forwarding | Yes |
| `ghcr.io/gryt-chat/client` | Web UI (browser access) | Optional |

See the [Docker Compose deployment guide](https://docs.gryt.chat/docs/deployment/docker-compose) for the full guide.

## Repository Structure

Monorepo using **git submodules**. Shared infrastructure lives in `ops/`.

| Package | Description | Image | Docs |
|---------|-------------|-------|------|
| [`packages/client`](https://github.com/Gryt-chat/client) | React web client | `ghcr.io/gryt-chat/client` | [docs](https://docs.gryt.chat/docs/client) |
| [`packages/server`](https://github.com/Gryt-chat/server) | Node.js signaling server | `ghcr.io/gryt-chat/server` | [docs](https://docs.gryt.chat/docs/server) |
| [`packages/sfu`](https://github.com/Gryt-chat/sfu) | Go SFU media server | `ghcr.io/gryt-chat/sfu` | [docs](https://docs.gryt.chat/docs/sfu) |
| [`packages/auth`](https://github.com/Gryt-chat/auth) | Keycloak auth service | — | — |
| [`packages/docs`](https://github.com/Gryt-chat/docs) | Documentation site | `ghcr.io/gryt-chat/docs` | — |
| [`packages/site`](https://github.com/Gryt-chat/site) | Landing page | `ghcr.io/gryt-chat/site` | — |

## Contributing

See the [contributing guide](https://docs.gryt.chat/docs/guide/contributing) for how to get involved.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

For commercial licensing inquiries, contact [sivert@gryt.chat](mailto:sivert@gryt.chat).
