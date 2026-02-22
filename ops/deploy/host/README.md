## Hosting with Cloudflare Tunnel (Docker Compose)

This folder contains a **single compose stack** that runs:
- **client** (static web app)
- **server** (Socket.IO signaling + REST)
- **sfu** (WebRTC media SFU)
- **scylla** (persistent DB)
- **minio** (S3-compatible uploads) + **minio-init**

### Quick start

1) Create an env file:

```bash
cd deploy/host
cp .env.example .env
```

2) Edit `deploy/host/.env`:
- Set **`JWT_SECRET`** (required)
- Set **`SFU_PUBLIC_HOST`** to your public `wss://` SFU hostname
- Set **`CORS_ORIGIN`** to your client origin (e.g. `https://gryt.example.com`)

3) Start:

```bash
docker compose -f compose.yml up -d --build
```

### Cloudflare Tunnel routing

Cloudflare Tunnel terminates TLS at the edge. Your origin can stay HTTP on localhost.

Example `cloudflared` ingress mapping (conceptually):
- **Client**: `https://gryt.example.com`  → `http://127.0.0.1:8080`
- **Server**: `https://api.gryt.example.com` → `http://127.0.0.1:5000` (must support WebSocket upgrade)
- **SFU WS**: `https://sfu.example.com` → `http://127.0.0.1:5005` (must support WebSocket upgrade)

Make sure your client is configured to connect to the **server** hostname you expose (typically a subdomain like `api.*`).

### Firewall / networking (critical)

Cloudflare Tunnel does **not** proxy WebRTC media (UDP). You must expose the SFU UDP range directly.

- **Open/forward UDP** `SFU_UDP_MIN..SFU_UDP_MAX` (default `10000-10019/udp`) to the host running the `sfu` container.
- If the host is behind NAT or has multiple interfaces, set `SFU_ADVERTISE_IP` to its public IP.

### Health endpoints

- Client: `GET /health` (on `CLIENT_HTTP_PORT`)
- Server: `GET /health` (on `SERVER_HTTP_PORT`)
- SFU: `GET /health` (on `SFU_WS_PORT`)

