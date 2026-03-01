<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt</h1>
  <p><strong>Open-source WebRTC voice chat platform</strong></p>
  <p>
    <a href="https://github.com/Gryt-chat/gryt/releases/latest"><img src="https://img.shields.io/github/v/release/Gryt-chat/gryt" alt="GitHub Release" /></a>
    <a href="https://github.com/Gryt-chat/gryt/stargazers"><img src="https://img.shields.io/github/stars/Gryt-chat/gryt" alt="GitHub Stars" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
    <a href="https://docs.gryt.chat"><img src="https://img.shields.io/badge/docs-docs.gryt.chat-blue" alt="Docs" /></a>
  </p>
  <p>
    <a href="https://snapcraft.io/gryt-chat"><img alt="Snap Store" src="https://snapcraft.io/gryt-chat/badge.svg" /></a>

    <a href="https://aur.archlinux.org/packages/gryt-chat-bin"><img alt="AUR package" src="https://img.shields.io/aur/version/gryt-chat-bin" /></a>
    <a href="https://ghcr.io/gryt-chat/server"><img src="https://img.shields.io/badge/Docker-ghcr.io-blue?logo=docker&logoColor=white" alt="Docker" /></a>
  </p>

  <img src="/.github/preview.png" width="700" alt="Gryt preview" />

  <br />

  <strong><a href="https://app.gryt.chat">Try Gryt instantly at app.gryt.chat</a></strong> — no download or setup required.
</div>

<br />

> [!CAUTION]
> **Early Development Stage** — This project is experimental and under active development. Expect breaking changes.

## Features

- Crystal-clear voice chat powered by WebRTC with Opus codec
- Screen sharing with audio capture
- Text chat with Markdown, mentions, and file sharing
- Self-hostable with Docker Compose
- LAN server discovery via mDNS
- Global push-to-talk with configurable keybinds
- RNNoise-based noise suppression
- Auto-updates

## Download

| Platform | Link |
|----------|------|
| Web | [app.gryt.chat](https://app.gryt.chat) |
| Linux (AppImage / deb) | [GitHub Releases](https://github.com/Gryt-chat/gryt/releases/latest) |
| Linux (Snap) | [Snap Store](https://snapcraft.io/gryt-chat) |

| Linux (Arch) | [AUR: gryt-chat-bin](https://aur.archlinux.org/packages/gryt-chat-bin) |
| Windows | [GitHub Releases](https://github.com/Gryt-chat/gryt/releases/latest) |
| macOS | [GitHub Releases](https://github.com/Gryt-chat/gryt/releases/latest) |

## Self-Hosting

See the **[Quick Start guide](https://docs.gryt.chat/docs/guide/quick-start)** to self-host Gryt with Docker Compose — two files, one command, no cloning required.

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
