<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt</h1>
  <p><strong>Open-source WebRTC voice, video and text chat</strong></p>
  <p>
    <a href="https://github.com/Gryt-chat/gryt/releases/latest"><img src="https://img.shields.io/github/v/release/Gryt-chat/gryt?style=flat-square&label=release&color=968FF8&cacheSeconds=3600" alt="GitHub Release" /></a>
    <a href="https://github.com/Gryt-chat/gryt/stargazers"><img src="https://img.shields.io/github/stars/Gryt-chat/gryt?style=flat-square&color=968FF8" alt="GitHub Stars" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-968FF8?style=flat-square" alt="License: AGPL-3.0" /></a>
    <a href="https://docs.gryt.chat"><img src="https://img.shields.io/badge/docs-docs.gryt.chat-968FF8?style=flat-square" alt="Docs" /></a>
  </p>
  <p>
    <a href="https://snapcraft.io/gryt-chat"><img alt="Snap Store" src="https://img.shields.io/snapcraft/v/gryt-chat/latest/stable?style=flat-square&label=snap&color=968FF8" /></a>
    <a href="https://aur.archlinux.org/packages/gryt-chat-bin"><img alt="AUR package" src="https://img.shields.io/aur/version/gryt-chat-bin?style=flat-square&label=aur&color=968FF8" /></a>
    <a href="https://ghcr.io/gryt-chat/server"><img src="https://img.shields.io/badge/docker-ghcr.io-968FF8?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
  </p>

  <img src="/.github/preview.webp" width="700" alt="The Gryt desktop client: a voice call with six people, a chat channel, and the member list" />

  <br />

  <strong><a href="https://app.gryt.chat">Try Gryt instantly at app.gryt.chat</a></strong> — no download or setup required.
</div>

<br />

> [!CAUTION]
> **Early development.** Gryt is experimental and changes often. Expect breaking changes.

## Why

Most voice platforms are owned by companies that monetise the conversation and
decide who gets to leave. Gryt is built the other way round — you run the
server, the data sits on your disk, and nobody needs an account with us to talk
to you.

<table>
<tr>
<td width="50%" valign="top">

**No account required**

A server chooses which identities it admits. Guests hold a keypair on their own
device. An account carries your identity *between* servers — it is not the price
of entry.

</td>
<td width="50%" valign="top">

**Real-time voice and video**

Go and Pion WebRTC relay voice, camera and screen share without transcoding.
Noise suppression, echo cancellation and voice activity detection run on the
client.

</td>
</tr>
<tr>
<td valign="top">

**Yours to run**

Docker Compose, Helm, or a Cloudflare Tunnel. One compose file can host as many
servers as you like — they share an SFU.

</td>
<td valign="top">

**Desktop and web**

Electron app for Linux, macOS and Windows with auto-updates, plus a browser
client. The desktop app can host a server on its own.

</td>
</tr>
<tr>
<td valign="top">

**Files and messages**

Persistent chat backed by SQLite, uploads to any S3-compatible store, and
thumbnails generated out of process so a bad image cannot take the server down.

</td>
<td valign="top">

**Open about how it is built**

Gryt is developed partly with AI assistance. The
[policy](https://docs.gryt.chat/docs/about/ai) says which parts of the codebase
never merge without a human reading the whole diff.

</td>
</tr>
</table>

## Features

- Voice chat over WebRTC with the Opus codec
- Video chat from your camera
- Camera video and screen sharing, both with audio
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

## Self-hosting

See the **[Quick Start guide](https://docs.gryt.chat/docs/host/quick-start)** to self-host Gryt with Docker Compose — two files, one command, no cloning required.

Or manage servers from a terminal with the **[Gryt CLI](https://docs.gryt.chat/docs/host/cli)**, which writes the compose file for you:

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

See the [contributing guide](https://docs.gryt.chat/docs/about/contributing) for how to get involved.

Nothing security-relevant merges without being read line by line — the SFU, authentication, identity, the image worker and the data layer only change through a reviewed pull request. See the [AI policy](https://docs.gryt.chat/docs/about/ai) for the exact paths, how to verify it, and the disclosure rules for contributions.

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
- [Base UI](https://base-ui.com/) — Accessible, unstyled component primitives, which [`@gryt/ui`](https://github.com/Gryt-chat/ui) is built on and the client renders through
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
