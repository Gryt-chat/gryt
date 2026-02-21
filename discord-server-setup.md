# Gryt Chat Discord Server Setup Guide

A step-by-step guide to setting up the official Gryt Chat Discord server.

---

## Step 1: Server Settings

1. **Server Name:** `Gryt Chat`
2. **Server Icon:** Use the Gryt logo
3. **Verification Level:** Medium (must be registered on Discord for longer than 5 minutes)
4. **Default Notification Settings:** Only @mentions

---

## Step 2: Roles

Create these roles **in this order** (top = highest priority):

| Role | Color | Permissions | Mentionable |
|---|---|---|---|
| `Admin` | Red `#ED4245` | Administrator | No |
| `Moderator` | Blue `#5865F2` | Manage Messages, Kick, Ban, Timeout, Manage Threads | No |
| `Core Team` | Purple `#9B59B6` | Same as Moderator | No |
| `Contributor` | Green `#57F287` | Default | Yes |
| `Server Operator` | Orange `#E67E22` | Default | Yes |
| `Beta Tester` | Yellow `#FEE75C` | Default | Yes |
| `Announcements` | Grey `#99AAB5` | Default | Yes |

> **Tip:** Make `Contributor`, `Server Operator`, `Beta Tester`, and `Announcements` self-assignable
> using Discord's Onboarding feature or a bot like Carl-bot.

---

## Step 3: Categories & Channels

### Category: INFORMATION

All channels in this category should be **read-only** for @everyone (deny Send Messages).

---

#### #welcome

**Channel Topic:**
```
Welcome to the official Gryt Chat Discord server! Read the rules and grab your roles.
```

**Pinned Message — paste this as the first message:**

```
# Welcome to Gryt Chat! 👋

Gryt is an open-source, self-hostable WebRTC voice & text chat platform.

## Useful Links

🌐 **Website:** https://gryt.chat
📖 **Documentation:** https://docs.gryt.chat
💻 **GitHub:** https://github.com/Gryt-chat
🐳 **Docker Images:** https://github.com/orgs/Gryt-chat/packages

## Quick Links for Self-Hosters

- [Production Deployment Guide](https://docs.gryt.chat)
- [Helm Chart (Kubernetes)](https://github.com/Gryt-chat/gryt/tree/main/ops/helm/gryt)
- [Docker Compose Setup](https://github.com/Gryt-chat/gryt/tree/main/ops/deploy/compose)

## Getting Help

- For **client issues** (web app, desktop app): head to #client-support
- For **self-hosting help** (server, SFU, deployment, Docker, Kubernetes): head to #selfhost-support
- For **feature requests**: head to #suggestions
- For **bug reports**: open a GitHub Issue on the relevant repo

## Grab Your Roles

Pick the roles that apply to you:
- **Server Operator** — You run your own Gryt instance
- **Contributor** — You've contributed to the codebase
- **Beta Tester** — You want to test pre-release builds
- **Announcements** — Get pinged for new releases
```

---

#### #rules

**Channel Topic:**
```
Server rules — please read before participating.
```

**Pinned Message — paste this as the first message:**

```
# Server Rules

**1. Be respectful.**
Treat everyone with respect. No harassment, hate speech, discrimination, or personal attacks. We're all here because we like building and using cool software.

**2. No spam or self-promotion.**
Don't spam messages, links, or unsolicited self-promotion. Sharing relevant projects or tools in context is fine.

**3. Keep channels on topic.**
Use the appropriate channel for your message. Support questions go in the support channels, general chat goes in #general, etc.

**4. No NSFW content.**
This is a tech community. Keep it clean.

**5. Don't ping staff unnecessarily.**
Moderators and the core team are here to help, but please don't DM or ping them for support. Use the public support channels so others can benefit from the answers too.

**6. Search before asking.**
Check pinned messages, the FAQ, and the documentation before asking a question. Your question might already be answered.

**7. Use English.**
To keep the community accessible to everyone, please communicate in English.

**8. No piracy or illegal content.**
Don't share or request pirated software, cracks, or any illegal content.

**9. Follow Discord's Terms of Service.**
https://discord.com/terms

**Breaking the rules may result in a warning, timeout, or ban at moderator discretion.**
```

---

#### #faq

**Channel Topic:**
```
Frequently asked questions — check here before asking in support!
```

**Pinned Message — paste this as the first message:**

```
# Frequently Asked Questions

## General

**Q: What is Gryt Chat?**
A: Gryt is an open-source, self-hostable voice and text chat platform built on WebRTC. Think of it as a lightweight, self-hosted alternative to Discord for voice communication.

**Q: Is Gryt free?**
A: Yes. Gryt is fully open-source. You can self-host it for free. Authentication is centrally hosted at auth.gryt.chat at no cost.

**Q: What platforms are supported?**
A: Web (any modern browser), Windows, macOS, and Linux (via Electron desktop app).

---

## Self-Hosting

**Q: What do I need to self-host Gryt?**
A: At minimum:
- A server with Docker (or Kubernetes)
- A domain with TLS/HTTPS (required for WebRTC)
- UDP ports `10000-10004` open for the SFU
- A generated JWT secret (`openssl rand -base64 48`)
- ScyllaDB (for message persistence)
- S3-compatible storage (MinIO, AWS S3, Cloudflare R2) for file uploads

**Q: Do I need a TURN server?**
A: No. Gryt's SFU uses a pinned UDP port range (10000-10004), so a TURN server is not required.

**Q: What ports need to be open?**
A:
- `443/tcp` — HTTPS (reverse proxy)
- `5000/tcp` — Signaling server (behind reverse proxy)
- `5005/tcp` — SFU WebSocket (behind reverse proxy)
- `10000-10004/udp` — SFU media traffic (must be directly exposed)

**Q: Can I use Nginx/Caddy/Traefik as a reverse proxy?**
A: Yes, any of them work. You need to configure WebSocket proxying for the signaling server and SFU WebSocket endpoints.

**Q: What database does Gryt use?**
A: ScyllaDB (Cassandra-compatible) for persistent data like messages, channels, and user metadata.

---

## Client / Desktop App

**Q: The desktop app won't update. What do I do?**
A: Try downloading the latest release manually from GitHub: https://github.com/Gryt-chat/client/releases

**Q: I can't hear anyone / nobody can hear me.**
A: Check these things:
1. Make sure your browser/app has microphone permission
2. Check that the correct input/output devices are selected in Gryt settings
3. Make sure you're not muted or deafened
4. If self-hosting: verify UDP ports 10000-10004 are open on the SFU host

**Q: Does Gryt work on mobile?**
A: The web client is responsive and works on mobile browsers. There is no native mobile app yet.
```

---

#### #announcements

**Channel Topic:**
```
Official announcements from the Gryt team. @Announcements role gets pinged for new releases.
```

> This channel is for manual, important announcements — new major features, breaking changes, important news.

---

#### #releases

**Channel Topic:**
```
Automated release notifications from GitHub.
```

> **Set up a GitHub webhook:**
> 1. Go to **Server Settings → Integrations → Webhooks → New Webhook**
> 2. Name it `GitHub Releases`, set the channel to `#releases`
> 3. Copy the webhook URL
> 4. In each GitHub repo (client, server, sfu), go to **Settings → Webhooks → Add webhook**
> 5. Paste the Discord webhook URL, append `/github` to it (e.g., `https://discord.com/api/webhooks/.../github`)
> 6. Set Content type to `application/json`
> 7. Select **"Let me select individual events"** → check only **Releases**
> 8. Save
>
> Repeat for each repo: `Gryt-chat/client`, `Gryt-chat/server`, `Gryt-chat/sfu`

---

### Category: COMMUNITY

---

#### #general

**Channel Topic:**
```
General discussion about Gryt Chat and anything else. Keep it friendly!
```

---

#### #showcase

**Channel Topic:**
```
Show off your Gryt deployment, setup, or integrations!
```

---

#### #suggestions

**Channel Topic:**
```
Feature requests and ideas for Gryt Chat. Use threads to discuss individual suggestions.
```

---

### Category: SUPPORT

> **Recommendation:** Create these as **Forum channels** instead of regular text channels.
> Forum channels keep each issue in its own thread, making it much easier to track and search.
>
> To create a Forum channel: **Create Channel → Type: Forum**

---

#### #client-support (Forum)

**Channel Topic / Guidelines:**
```
Help with the Gryt web client and desktop app (Electron).

Before posting, please include:
- What platform you're on (Web/Windows/macOS/Linux)
- Browser name and version (if web)
- Desktop app version (if Electron)
- What you expected vs. what happened
- Any browser console errors (F12 → Console tab)
```

**Available Tags:**
- `Web Client`
- `Desktop - Windows`
- `Desktop - macOS`
- `Desktop - Linux`
- `Audio Issue`
- `Connection Issue`
- `UI Bug`
- `Solved`

---

#### #selfhost-support (Forum)

**Channel Topic / Guidelines:**
```
Help with self-hosting Gryt — server, SFU, Docker, Kubernetes, database, storage, and auth.

Before posting, please include:
- Your deployment method (Docker Compose / Kubernetes / bare metal)
- Which component is affected (Server / SFU / ScyllaDB / MinIO / Auth)
- Relevant config (redact secrets!)
- Error messages or logs
- Have you checked the docs? https://docs.gryt.chat
```

**Available Tags:**
- `Signaling Server`
- `SFU`
- `Docker`
- `Kubernetes / Helm`
- `Database (ScyllaDB)`
- `Storage (S3 / MinIO)`
- `Authentication`
- `Reverse Proxy`
- `Networking / Ports`
- `Solved`

---

### Category: DEVELOPMENT

---

#### #development

**Channel Topic:**
```
Discussion for contributors — architecture, code, PRs. GitHub: https://github.com/Gryt-chat
```

---

#### #bug-reports

**Channel Topic:**
```
Report bugs here. For tracking, please also open a GitHub Issue on the relevant repo.
```

---

### Category: STAFF (hidden from @everyone)

> Set permissions: Deny @everyone **View Channel** for this entire category.
> Allow `Moderator`, `Admin`, and `Core Team` roles.

---

#### #moderators

**Channel Topic:**
```
Moderator discussion, reports, and coordination.
```

---

#### #team-internal

**Channel Topic:**
```
Core team planning, deployments, incidents.
```

---

## Step 4: Onboarding Setup

Discord has a built-in Onboarding feature to let new members pick roles and channels.

1. Go to **Server Settings → Onboarding**
2. Enable Community (if not already)
3. Add a **Default Channels** step — select `#welcome`, `#rules`, `#general`, `#announcements`
4. Add a **Self Roles** step with these questions:

**Question: "What describes you?"** (multiple choice)
- 🖥️ I run my own Gryt server → assigns `Server Operator`
- 🛠️ I contribute to Gryt → assigns `Contributor`
- 🧪 I want to test beta releases → assigns `Beta Tester`

**Question: "Do you want release notifications?"** (multiple choice)
- 📢 Yes, ping me for new releases → assigns `Announcements`

---

## Step 5: Final Checklist

- [ ] Server icon and banner set
- [ ] All roles created with correct permissions
- [ ] All categories and channels created
- [ ] Channel permissions verified (INFORMATION channels are read-only)
- [ ] STAFF category is hidden from @everyone
- [ ] Welcome message posted and pinned in #welcome
- [ ] Rules posted and pinned in #rules
- [ ] FAQ posted and pinned in #faq
- [ ] GitHub webhooks set up for #releases (client, server, sfu repos)
- [ ] Forum channels have tags configured (#client-support, #selfhost-support)
- [ ] Onboarding / role selection configured
- [ ] Invite link created (set to never expire, unlimited uses)
- [ ] Test with an alt account to verify permissions and onboarding flow

---

## Optional: Bot Recommendations

| Bot | Purpose |
|---|---|
| **Carl-bot** | Reaction roles, auto-moderation, logging |
| **GitHub Bot** | Richer GitHub integration than webhooks (issue/PR previews) |
| **Discohook** | Design nice embed messages for #welcome and #rules |
| **ModMail** | Let users DM the bot to create private support tickets with staff |

---

## Invite Link Template

Once everything is set up, create a vanity invite or permanent link:

**Server Settings → Invites → Create Invite**
- Channel: `#welcome`
- Expire: Never
- Max Uses: Unlimited

Invite link: https://discord.gg/Q3JKUGsnHE
