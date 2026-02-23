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
curl -O https://raw.githubusercontent.com/Gryt-chat/gryt/main/docker-compose.yml
docker compose up -d
```

Once running, go to **[app.gryt.chat](https://app.gryt.chat)** and connect to your server using your machine's local IP (e.g. `192.168.x.x:5000`).

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
