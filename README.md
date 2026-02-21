# Gryt - WebRTC Voice Chat Platform

> [!CAUTION]
> **Early Development Stage** - This project is experimental and under active development. Expect breaking changes.

A WebRTC-based voice chat platform with real-time communication, advanced audio processing, and a modern UI. Built with TypeScript, React, and Go.

<div align="center">

![Preview](/.github/preview_client.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://golang.org/)

</div>

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Client    │    │  Gryt Server    │    │   SFU Server    │
│   (React/TS)    │◄──►│   (Node.js)     │◄──►│     (Go)        │
│                 │    │                 │    │                 │
│ • Voice UI      │    │ • Signaling     │    │ • Media Relay   │
│ • Audio Proc.   │    │ • User Mgmt     │    │ • WebRTC        │
│ • Server Mgmt   │    │ • Room Mgmt     │    │ • Track Mgmt    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                       ┌─────────────────┐
                       │  Auth Service   │
                       │ (Hosted by Gryt)│
                       └─────────────────┘
```

| Component | Technology | Port |
|-----------|------------|------|
| **Web Client** | React + TypeScript + Vite | `3666` (dev) / `80` (prod) |
| **Gryt Server** | Bun + TypeScript + Socket.IO | `5000` |
| **SFU Server** | Go + Pion WebRTC | `5005` (WS) + `10000-10004/udp` (media) |
| **Auth** | Hosted by Gryt team | N/A (uses `auth.gryt.chat`) |

---

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (or Node.js 18+)
- [Go](https://go.dev/) 1.21+
- [Docker](https://www.docker.com/) (for ScyllaDB + MinIO dev deps)
- [tmux](https://github.com/tmux/tmux) (used by the dev launcher)

### One command

```bash
git clone --recurse-submodules https://github.com/Gryt-chat/gryt.git
cd gryt
./ops/start_dev.sh
```

> Already cloned without `--recurse-submodules`? Run `git submodule update --init --recursive`.

This spins up **everything** in a tmux session:
- ScyllaDB + MinIO via Docker (messages, uploads)
- SFU on `:5005`
- Two signaling servers (ws1 on `:5000`, ws2 on `:5001`)
- Vite dev server on `:3666`

Open **http://localhost:3666** and you're in.

### Running services individually

If you prefer separate terminals instead of tmux:

```bash
# 1. Dev dependencies (ScyllaDB + MinIO)
./ops/dev/deps.sh

# 2. SFU
./ops/dev/sfu.sh

# 3. Signaling server 1
./ops/dev/ws1.sh

# 4. Signaling server 2 (optional)
./ops/dev/ws2.sh

# 5. Client
./ops/dev/client.sh
```

### Without database / S3

If you just want voice chat without persistence:

```bash
DEV_WITH_DB=0 DEV_WITH_S3=0 ./ops/start_dev.sh
```

---

## Production Deployment

### What you need

| Requirement | Notes |
|-------------|-------|
| **Domain + TLS** | Browsers require `wss://` for WebRTC. Put a reverse proxy (Caddy/Nginx/Traefik) in front. |
| **UDP ports open** | The SFU needs a dedicated UDP range reachable from the internet (default `10000-10004`). |
| **JWT_SECRET** | A strong random secret for signing session tokens. Generate with `openssl rand -base64 48`. |
| **ScyllaDB** | For persistent messages, channels, user data, refresh tokens. |
| **S3-compatible storage** | For file uploads (AWS S3, Cloudflare R2, MinIO, etc.). |

No TURN server is required. Voice media goes directly over the pinned UDP port range.

### Ports to open

| Port | Protocol | Service |
|------|----------|---------|
| `443` | TCP | Your reverse proxy (TLS termination for client + signaling + SFU WS) |
| `5000` | TCP | Signaling server (behind reverse proxy) |
| `5005` | TCP | SFU WebSocket (behind reverse proxy) |
| `10000-10004` | **UDP** | SFU WebRTC media (must be directly reachable, not proxied) |

### Quick start (Docker Compose)

**1. Create env files**

```bash
# SFU
cp packages/sfu/env.example packages/sfu/.env

# Server
cp packages/server/example.env packages/server/.env
```

**2. Edit `packages/server/.env`** (minimum required changes):

```env
# Auth – generate with: openssl rand -base64 48
JWT_SECRET="your-strong-secret-here"

SFU_WS_HOST="wss://sfu.yourdomain.com"
CORS_ORIGIN="https://yourdomain.com"
SERVER_NAME="My Server"

# Database
SCYLLA_CONTACT_POINTS=your-scylla-host
SCYLLA_KEYSPACE=gryt

# Object storage
S3_ENDPOINT=https://your-s3-endpoint.com
S3_ACCESS_KEY_ID=your_key
S3_SECRET_ACCESS_KEY=your_secret
S3_BUCKET=gryt
```

**3. Edit `packages/sfu/.env`** (usually defaults are fine):

```env
ICE_UDP_PORT_MIN=10000
ICE_UDP_PORT_MAX=10004
# Set this if the SFU host is behind NAT:
# ICE_ADVERTISE_IP=203.0.113.10
```

**4. Start**

```bash
docker compose -f ops/deploy/compose/prod.yml up -d --build
```

**5. Point your reverse proxy** at:
- Client: `localhost:80`
- Signaling: `localhost:5000` (WebSocket upgrade)
- SFU WS: `localhost:5005` (WebSocket upgrade)

Health checks: `GET /health` on all three services.

### Kubernetes (Helm)

```bash
helm install gryt ./ops/helm/gryt -f my-values.yaml
```

See [`ops/helm/gryt/`](ops/helm/gryt/) for the chart and [`ops/helm/gryt/examples/production-values.yaml`](ops/helm/gryt/examples/production-values.yaml) for a production example.

---

## Features

- **Voice**: Crystal-clear audio with noise suppression, echo cancellation, voice activity detection
- **Audio pipeline**: Noise gate, volume control, mute/deafen, loopback monitoring
- **Multi-server**: Connect to multiple servers simultaneously, seamless switching
- **Text chat**: Persistent messages with file uploads (images, documents)
- **Modern UI**: Radix UI, dark/light themes, responsive, accessible
- **Rate limiting**: Score-based system with user-friendly feedback
- **Auth**: Centrally hosted Keycloak (no setup required)

## Repository Structure

This is a monorepo that uses **git submodules**. Each core component lives in its own repo under [Gryt-chat](https://github.com/Gryt-chat) and is pulled in here under `packages/`. Shared infrastructure (Dockerfiles, Compose files, Helm charts, dev scripts) lives in `ops/`.

```
gryt/
├── packages/           # Git submodules — each is its own repo
│   ├── auth/           # Keycloak auth service, themes, and ops tooling
│   ├── client/         # React web client with audio processing
│   ├── server/         # Node.js signaling server
│   ├── sfu/            # SFU media server (Go + Pion WebRTC)
│   ├── site/           # Landing page (gryt.chat)
│   └── docs/           # Documentation site (Fumadocs + Next.js)
├── ops/                # Shared infrastructure (not a submodule)
│   ├── deploy/         # Docker Compose files for dev and prod
│   ├── docker/         # Dockerfiles for client, server, and SFU
│   ├── dev/            # Individual dev launcher scripts
│   ├── helm/           # Kubernetes Helm chart
│   └── start_dev.sh    # One-command tmux dev launcher
├── .github/
├── .gitmodules
├── LICENSE
└── README.md
```

| Submodule | Repo |
|-----------|------|
| `packages/auth` | [Gryt-chat/auth](https://github.com/Gryt-chat/auth) |
| `packages/client` | [Gryt-chat/client](https://github.com/Gryt-chat/client) |
| `packages/server` | [Gryt-chat/server](https://github.com/Gryt-chat/server) |
| `packages/sfu` | [Gryt-chat/sfu](https://github.com/Gryt-chat/sfu) |
| `packages/site` | [Gryt-chat/site](https://github.com/Gryt-chat/site) |
| `packages/docs` | [Gryt-chat/docs](https://github.com/Gryt-chat/docs) |

---

## Working with Submodules

### Cloning

Always clone with `--recurse-submodules` so all packages are fetched:

```bash
git clone --recurse-submodules https://github.com/Gryt-chat/gryt.git
```

If you already cloned without it, initialize the submodules manually:

```bash
git submodule update --init --recursive
```

### Recommended git config

Run these once after cloning to make submodules work seamlessly:

```bash
# Auto-push submodule commits when you push the monorepo
git config push.recurseSubmodules on-demand

# Auto-update submodules when you pull/checkout/switch branches
git config submodule.recurse true
```

With these settings, `git pull` and `git push` behave the way you'd expect -- submodules stay in sync automatically.

### Pulling updates

With `submodule.recurse true` set, a normal `git pull` also updates submodules. Otherwise:

```bash
git pull --recurse-submodules
```

To move every submodule to the **latest commit on its remote** (not just the recorded commit):

```bash
git submodule update --remote
```

### Making changes inside a submodule

Each `packages/*` directory is a full git repo. You can work in it like any normal repo:

```bash
cd packages/client
# ... make edits ...
git add -A && git commit -m "Add feature"
```

Then update the monorepo to record the new commit:

```bash
cd ../..                             # back to monorepo root
git add packages/client
git commit -m "Update client"
git push                             # pushes client first, then monorepo
```

With `push.recurseSubmodules on-demand`, that single `git push` automatically pushes the submodule commit to Gryt-chat/client before pushing the monorepo to Gryt-chat/gryt.

### Tips

- **Submodule = pointer.** The monorepo stores a specific commit hash for each submodule, not the code itself. When you `git add packages/client`, you're updating that pointer.
- **Branches are independent.** The monorepo branch and each submodule's branch are separate. You can have `main` in the monorepo pointing to a `develop` commit in a submodule.
- **VS Code / Cursor.** Both detect submodules automatically. You'll see separate source control panels for the monorepo and each submodule.

## Documentation

- [Client docs](https://github.com/Gryt-chat/client#readme) - React app, audio processing
- [Server docs](https://github.com/Gryt-chat/server#readme) - Signaling, room management
- [SFU docs](https://github.com/Gryt-chat/sfu#readme) - Media forwarding, WebRTC
- [Deployment guide](https://github.com/Gryt-chat/docs) - Full production deployment reference

## Troubleshooting

**No audio?**
- Check microphone permissions in your browser
- Verify STUN servers are configured in the SFU `.env`
- In production: ensure UDP `10000-10004` is open and reachable on the SFU host
- In production: ensure everything is served over HTTPS/WSS

**Can't connect?**
- Check that `SFU_WS_HOST` in `packages/server/.env` is a public `wss://` URL browsers can reach
- Check `CORS_ORIGIN` matches your client domain
- Look at browser console + server logs

## License

[MIT](LICENSE)
