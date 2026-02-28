## Hosting with Cloudflare Tunnel (Docker Compose)

This folder contains a **single compose stack** that runs:
- **server** (Socket.IO signaling + REST, with embedded SQLite)
- **sfu** (WebRTC media SFU)
- **minio** (S3-compatible uploads) + **minio-init**
- **client** (web UI — dev/local only, behind `--profile web`)

### Quick start

1) Create an env file:

```bash
cd deploy/host
cp .env.example .env
```

2) Edit `deploy/host/.env`:
- Set **`JWT_SECRET`** (required)
- Set **`SFU_PUBLIC_HOST`** to your public `wss://` SFU hostname
- Set **`CORS_ORIGIN`** to include `http://127.0.0.1:15738` (desktop app) and `https://app.gryt.chat` (hosted web client)

3) Start:

```bash
docker compose -f compose.yml up -d --build
```

### Cloudflare Tunnel routing

Cloudflare Tunnel terminates TLS at the edge. Your origin can stay HTTP on localhost.

Example `cloudflared` ingress mapping (conceptually):
- **Server**: `https://api.gryt.example.com` → `http://127.0.0.1:5000` (must support WebSocket upgrade)
- **SFU WS**: `https://sfu.example.com` → `http://127.0.0.1:5005` (must support WebSocket upgrade)

Users connect via the [Gryt desktop app](https://github.com/Gryt-chat/gryt/releases) or the hosted web client at [app.gryt.chat](https://app.gryt.chat).

**DNS proxy status**: Both hostnames must be set to **Proxied** (orange cloud) in Cloudflare DNS. This includes `sfu.example.com` — even though WebRTC media goes direct over UDP, the SFU WebSocket signaling still routes through the tunnel.

### Firewall / networking (critical)

Cloudflare Tunnel does **not** proxy WebRTC media (UDP). You must expose the SFU UDP range directly.

- **Open/forward UDP** `SFU_UDP_MIN..SFU_UDP_MAX` (default `10000-10019/udp`) to the host running the `sfu` container.
- If the host is behind NAT or has multiple interfaces, set `SFU_ADVERTISE_IP` to its public IP.

### Health endpoints

- Server: `GET /health` (on `SERVER_HTTP_PORT`)
- SFU: `GET /health` (on `SFU_WS_PORT`)

