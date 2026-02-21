<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt</h1>
  <p><strong>Open-source WebRTC voice chat platform</strong></p>
  <p>
    <a href="https://docs.gryt.chat"><img src="https://img.shields.io/badge/docs-docs.gryt.chat-blue" alt="Docs" /></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" /></a>
    <a href="https://golang.org/"><img src="https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white" alt="Go" /></a>
  </p>

  <img src="/.github/preview_client.png" width="700" alt="Gryt preview" />
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

## Repository Structure

Monorepo using **git submodules**. Shared infrastructure lives in `ops/`.

| Package | Description | Docs |
|---------|-------------|------|
| [`packages/client`](https://github.com/Gryt-chat/client) | React web client | [docs](https://docs.gryt.chat/docs/client) |
| [`packages/server`](https://github.com/Gryt-chat/server) | Node.js signaling server | [docs](https://docs.gryt.chat/docs/server) |
| [`packages/sfu`](https://github.com/Gryt-chat/sfu) | Go SFU media server | [docs](https://docs.gryt.chat/docs/sfu) |
| [`packages/auth`](https://github.com/Gryt-chat/auth) | Keycloak auth service | — |
| [`packages/docs`](https://github.com/Gryt-chat/docs) | Documentation site | — |
| [`packages/site`](https://github.com/Gryt-chat/site) | Landing page | — |

## Contributing

See the [contributing guide](https://docs.gryt.chat/docs/guide/contributing) for how to get involved.

## License

[MIT](LICENSE)
