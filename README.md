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

  <img src="/.github/preview.png" width="700" alt="Gryt preview" />

  <br />

  <strong><a href="https://app.gryt.chat">Try Gryt instantly at app.gryt.chat</a></strong> — no download or setup required.
</div>

<br />

> [!CAUTION]
> **Early Development Stage** — This project is experimental and under active development. Expect breaking changes.

## Self-Hosting

```bash
mkdir gryt && cd gryt
curl -LO https://raw.githubusercontent.com/Gryt-chat/gryt/main/docker-compose.yml
curl -LO https://raw.githubusercontent.com/Gryt-chat/gryt/main/.env.example
cp .env.example .env
```

Open `.env` and review the key settings:

```bash
SERVER_NAME=My Gryt Server          # display name shown to users
SERVER_PASSWORD=                     # leave empty for open access, or set a password
JWT_SECRET=change-me-in-production   # IMPORTANT: run `openssl rand -base64 48` for a real secret
```

Then start the server:

```bash
docker compose up -d
```

Connect using the [Gryt desktop app](https://github.com/Gryt-chat/gryt/releases) or [app.gryt.chat](https://app.gryt.chat) — enter your server address (e.g. `localhost` or your public IP).

See the [deployment docs](https://docs.gryt.chat/docs/deployment) for configuration, `.env` options, and production setup.

## Development

```bash
git clone --recurse-submodules https://github.com/Gryt-chat/gryt.git
cd gryt
./ops/start_dev.sh
```

Open **http://localhost:3666** and you're in.

## Documentation

Full docs at **[docs.gryt.chat](https://docs.gryt.chat)** — architecture, configuration, deployment, and more.

## Contributing

See the [contributing guide](https://docs.gryt.chat/docs/guide/contributing) for how to get involved.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

For commercial licensing inquiries, contact [sivert@gryt.chat](mailto:sivert@gryt.chat).
