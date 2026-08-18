<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt</h1>
  <p><strong>Open-source WebRTC voice chat platform</strong></p>
  <p>
    <a href="https://github.com/Gryt-chat/gryt/releases/latest"><img src="https://img.shields.io/github/v/release/Gryt-chat/gryt?cacheSeconds=3600" alt="GitHub Release" /></a>
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

- Voice chat over WebRTC with the Opus codec
- Video chat from your camera
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

Or manage servers from a terminal with the **[Gryt CLI](https://docs.gryt.chat/docs/cli)**, which writes the compose file for you:

```bash
curl -fsSL https://get.gryt.chat | sh
```

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

Nothing security-relevant merges without being read line by line — the SFU, authentication, identity, the image worker and the data layer only change through a reviewed pull request. See the [AI policy](https://docs.gryt.chat/docs/guide/ai) for the exact paths, how to verify it, and the disclosure rules for contributions.

## Sponsors

<!-- sponsors:start -->
<!-- Monthly sponsors only, which is what the $25 and $500 tiers promise. A
     one-off payment is credited in the release notes and listed on
     gryt.chat/sponsors, not here. -->

Nobody sponsoring monthly yet.

<!-- sponsors:end -->

What sponsoring pays for, the tiers, and everyone who has sponsored:
[gryt.chat/sponsors](https://gryt.chat/sponsors). To sponsor:
[GitHub Sponsors](https://github.com/sponsors/Gryt-chat).

## Acknowledgments

Gryt wouldn't exist without these projects and resources. I'm forever grateful to the people behind them for sharing their work with the world.

**Libraries that power Gryt:**

- [Pion WebRTC](https://github.com/pion/webrtc) — Pure Go WebRTC stack that the entire SFU is built on. Sean DuBois and the Pion community taught me more about WebRTC than anything else
- [RNNoise](https://jmvalin.ca/demo/rnnoise/) via [@shiguredo/rnnoise-wasm](https://github.com/niccokunzmann/rnnoise-wasm) — Jean-Marc Valin's neural network noise suppression, compiled to WASM for the browser
- [Radix UI](https://www.radix-ui.com/) — Accessible, unstyled component primitives that form the backbone of the UI
- [Socket.IO](https://socket.io/) — Real-time signaling between client and server
- [Electron](https://www.electronjs.org/) — Desktop app shell with native OS integration

**Specs and references:**

- [MDN WebRTC API docs](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) — The single best reference for understanding WebRTC in the browser
- [AV1 RTP spec (Dependency Descriptor)](https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension) — The spec that made SVC layer-aware forwarding possible
- [WebRTC Simulcast Playground](https://orphis.github.io/webrtc-sandbox/simulcast-playground.html) by Orphis — Invaluable for understanding simulcast, SVC scalability modes, and encoder behavior
- [mediasoup documentation](https://mediasoup.org/documentation/) — Excellent SFU architecture reference that shaped how I think about track forwarding
- [Microsoft Application Loopback Audio Capture sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/) — The WASAPI example that showed how to capture per-process audio on Windows while excluding Gryt's own audio

**Projects that inspired the journey:**

- [Mumble](https://www.mumble.info/), [Jitsi](https://meet.jit.si/), [Revolt](https://revolt.chat/), [LiveKit](https://livekit.io/), [coturn](https://github.com/coturn/coturn), and many others — see [The Projects That Paved the Way](https://gryt.chat/blog/the-projects-that-paved-the-way) for the full story

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

For commercial licensing inquiries, contact [sivert@gryt.chat](mailto:sivert@gryt.chat).
