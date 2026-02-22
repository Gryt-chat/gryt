<h3 align="center">
 <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="100" alt="Logo"/><br/>
 <img src="" alt="" height="32" width="0px"/>
 Gryt Chat
 <img src="" alt="" height="32" width="0px"/>
</h3>

<p align="center">
Gryt is an open-source voice and text chat platform that values privacy and user control of data. With Gryt, users can host their own servers, giving them full control over their conversations and data. Gryt is a secure, private communication platform that empowers users to communicate freely while protecting their privacy.
</p>

<p align="center">
 <a href="https://github.com/Gryt-chat/gryt/blob/main/LICENSE">
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square" alt="AGPL-3.0 License"/>
 </a>
 <a href="https://github.com/Gryt-chat/gryt">
  <img src="https://img.shields.io/github/stars/Gryt-chat/gryt?style=flat-square&color=yellow" alt="Stars"/>
 </a>
 <a href="https://github.com/Gryt-chat/gryt/pulls">
  <img src="https://img.shields.io/github/issues-pr/Gryt-chat/gryt?style=flat-square&color=green" alt="Pull Requests"/>
 </a>
 <a href="https://github.com/Gryt-chat/gryt/issues">
  <img src="https://img.shields.io/github/issues/Gryt-chat/gryt?style=flat-square&color=red" alt="Issues"/>
 </a>
</p>

<p align="center">
 <a href="https://gryt.chat">Website</a> ·
 <a href="https://app.gryt.chat">Live App</a> ·
 <a href="https://docs.gryt.chat">Documentation</a> ·
 <a href="https://github.com/Gryt-chat/gryt">Source Code</a> ·
 <a href="https://github.com/Gryt-chat/gryt/issues/new?template=bug_report.md">Report a Bug</a> ·
 <a href="https://github.com/Gryt-chat/gryt/issues/new?template=feature_request.md">Request a Feature</a>
</p>

---

> [!CAUTION]
> **Early Development Stage** — This project is experimental and under active development. Expect breaking changes.

---

### Why Gryt?

Most communication platforms today are owned by corporations that monetize your conversations, lock you into their ecosystem, and give you zero control over where your data lives. **Gryt exists to change that.**

- **Self-hostable** — Run your own server. Your data stays on your hardware.
- **Open source** — Every line is auditable. No telemetry, no tracking, no surprises.
- **Full-featured** — Crystal-clear voice chat, persistent text messaging, file sharing — all in one platform.
- **Modern stack** — Built with TypeScript, React, Go, and WebRTC for real-time performance.

---

### What's Inside

<table>
<tr>
<td width="50%" valign="top">

**Core Platform** — [`gryt`](https://github.com/Gryt-chat/gryt)

A monorepo using git submodules containing everything you need:

| Component | Repo | Built With |
|-----------|------|-----------|
| Web Client | [`packages/client`](https://github.com/Gryt-chat/client) | React · TypeScript · Vite · Electron |
| Signaling Server | [`packages/server`](https://github.com/Gryt-chat/server) | Node.js · Express · Socket.IO |
| SFU (Media Server) | [`packages/sfu`](https://github.com/Gryt-chat/sfu) | Go · Pion WebRTC |
| Auth | [`packages/auth`](https://github.com/Gryt-chat/auth) | Keycloak · OIDC |
| Docs | [`packages/docs`](https://github.com/Gryt-chat/docs) | Next.js · Fumadocs |
| Landing Page | [`packages/site`](https://github.com/Gryt-chat/site) | React · Vite |

</td>
<td width="50%" valign="top">

**Deployment Options**

| Method | Best For |
|--------|----------|
| [Docker Compose](https://docs.gryt.chat/docs/deployment/docker-compose) | Quick self-hosting |
| [Helm Chart](https://github.com/Gryt-chat/gryt/tree/main/ops/helm/gryt) | Kubernetes clusters |
| [Cloudflare Tunnel](https://docs.gryt.chat/docs/deployment/cloudflare-tunnel) | Tunneled hosting |
| [Dev Scripts](https://docs.gryt.chat/docs/guide/quick-start) | Local development |

Get started in one command:

```bash
git clone --recurse-submodules https://github.com/Gryt-chat/gryt.git
cd gryt && ./ops/start_dev.sh
```

</td>
</tr>
</table>

Pre-built Docker images are published to GitHub Container Registry:

| Image | Purpose |
|-------|---------|
| `ghcr.io/gryt-chat/server` | Signaling, chat, file uploads |
| `ghcr.io/gryt-chat/sfu` | WebRTC media forwarding |
| `ghcr.io/gryt-chat/client` | Web UI (browser access) |

---

### Features

<table>
<tr>
<td width="33%" align="center">
<h4>Voice Chat</h4>
<p>WebRTC-powered real-time audio with noise suppression, echo cancellation, voice activity detection, and a configurable audio pipeline.</p>
</td>
<td width="33%" align="center">
<h4>Text & Files</h4>
<p>Persistent messaging backed by ScyllaDB with file uploads, image thumbnails, and S3-compatible object storage.</p>
</td>
<td width="33%" align="center">
<h4>Multi-Server</h4>
<p>Connect to multiple self-hosted servers simultaneously and switch between them seamlessly from a single client.</p>
</td>
</tr>
<tr>
<td width="33%" align="center">
<h4>Privacy First</h4>
<p>Self-host everything. Your messages, files, and voice data never touch a third-party server unless you choose to.</p>
</td>
<td width="33%" align="center">
<h4>Desktop & Web</h4>
<p>Clean, accessible interface built with Radix UI. Dark and light themes, responsive layout, and an Electron desktop app with auto-updates for Linux, macOS, and Windows.</p>
</td>
<td width="33%" align="center">
<h4>Easy Deployment</h4>
<p>Docker Compose for quick setups, Helm charts for Kubernetes, Cloudflare Tunnels for easy access, and comprehensive <a href="https://docs.gryt.chat">docs</a> to guide you through production deployment.</p>
</td>
</tr>
</table>

---

### Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Client    │    │  Gryt Server    │    │   SFU Server    │
│   (React/TS)    │◄──►│ (Node.js/Express)│◄──►│     (Go)        │
│                 │    │                 │    │                 │
│ • Voice UI      │    │ • Signaling     │    │ • Media Relay   │
│ • Audio Proc.   │    │ • Persistence   │    │ • WebRTC        │
│ • Multi-Server  │    │ • File Uploads  │    │ • Track Mgmt    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                      │                      │
         │              ┌───────┴───────┐              │
         │              │   ScyllaDB    │              │
         │              │   + MinIO/S3  │              │
         │              └───────────────┘              │
         │                                             │
         └──────────── WebRTC Media (UDP) ─────────────┘
```

---

### Contributing

We welcome contributions of all kinds — code, documentation, bug reports, and feature ideas.

1. **Fork** the repo and create your branch from `main`
2. **Make** your changes and ensure tests pass
3. **Open** a pull request with a clear description of what you've done

Check out the [contributing guide](https://docs.gryt.chat/docs/guide/contributing), browse the [issue tracker](https://github.com/Gryt-chat/gryt/issues) for open issues, or create a [feature request](https://github.com/Gryt-chat/gryt/issues/new?template=feature_request.md) if you have an idea.

---

<p align="center">
 <sub>Made with care by the Gryt community · Licensed under <a href="https://github.com/Gryt-chat/gryt/blob/main/LICENSE">AGPL-3.0</a></sub>
</p>
