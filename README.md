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
git clone https://github.com/sivert-io/WebSocket-Voice.git
cd WebSocket-Voice
./start_dev.sh
```

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
./dev/deps.sh

# 2. SFU
./dev/sfu.sh

# 3. Signaling server 1
./dev/ws1.sh

# 4. Signaling server 2 (optional)
./dev/ws2.sh

# 5. Client
./dev/client.sh
```

### Without database / S3

If you just want voice chat without persistence:

```bash
DEV_WITH_DB=0 DEV_WITH_S3=0 ./start_dev.sh
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
cp sfu-v2/env.example sfu-v2/.env

# Server
cp server/example.env server/.env
```

**2. Edit `server/.env`** (minimum required changes):

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

**3. Edit `sfu-v2/.env`** (usually defaults are fine):

```env
ICE_UDP_PORT_MIN=10000
ICE_UDP_PORT_MAX=10004
# Set this if the SFU host is behind NAT:
# ICE_ADVERTISE_IP=203.0.113.10
```

**4. Start**

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

**5. Point your reverse proxy** at:
- Client: `localhost:80`
- Signaling: `localhost:5000` (WebSocket upgrade)
- SFU WS: `localhost:5005` (WebSocket upgrade)

Health checks: `GET /health` on all three services.

### Kubernetes (Helm)

```bash
helm install gryt ./helm/gryt -f my-values.yaml
```

See [`helm/gryt/`](helm/gryt/) for the chart and [`helm/gryt/examples/production-values.yaml`](helm/gryt/examples/production-values.yaml) for a production example.

---

## Features

- **Voice**: Crystal-clear audio with noise suppression, echo cancellation, voice activity detection
- **Audio pipeline**: Noise gate, volume control, mute/deafen, loopback monitoring
- **Multi-server**: Connect to multiple servers simultaneously, seamless switching
- **Text chat**: Persistent messages with file uploads (images, documents)
- **Modern UI**: Radix UI, dark/light themes, responsive, accessible
- **Rate limiting**: Score-based system with user-friendly feedback
- **Auth**: Centrally hosted Keycloak (no setup required)

## Documentation

- [Client docs](client/README.md) - React app, audio processing
- [Server docs](server/README.md) - Signaling, room management
- [SFU docs](sfu-v2/README.md) - Media forwarding, WebRTC
- [Deployment guide](docs/content/docs/deployment.mdx) - Full production deployment reference
- [Rate limiting](docs/content/docs/development/rate-limiting.mdx) - Score-based rate limiting system

## Troubleshooting

**No audio?**
- Check microphone permissions in your browser
- Verify STUN servers are configured in the SFU `.env`
- In production: ensure UDP `10000-10004` is open and reachable on the SFU host
- In production: ensure everything is served over HTTPS/WSS

**Can't connect?**
- Check that `SFU_WS_HOST` in `server/.env` is a public `wss://` URL browsers can reach
- Check `CORS_ORIGIN` matches your client domain
- Look at browser console + server logs

## License

[MIT](LICENSE)
