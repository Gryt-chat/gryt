# CI / CD Guide

This document explains the GitHub Actions workflows in the Gryt monorepo and
how to cut a new release.

---

## Workflows

### `build.yml` — Continuous Integration

**Trigger:** every push or pull-request targeting `main` that changes one of
`packages/client`, `packages/server`, or `packages/sfu`.

| Job | Runner | What it does |
|-----|--------|--------------|
| `build-client` | ubuntu-latest | Checks out the `client` submodule, installs pnpm deps, and runs a Vite renderer build to catch TypeScript / bundler errors early. |
| `build-server` | ubuntu-latest | Checks out the `server` submodule, installs npm deps, and runs `tsc` to catch type errors. |
| `build-sfu` | ubuntu-latest | Checks out the `sfu` submodule and runs `go build` to ensure the Go code compiles. |

> **Path filters** mean the CI only runs the jobs whose submodule pointer has
> actually changed, keeping feedback fast.

---

### `release.yml` — Build & Publish a Release

**Trigger (automatic):** push a version tag matching `v<major>.<minor>.<patch>`
or `v<major>.<minor>.<patch>-<pre-release>` (e.g. `v1.2.0` or `v1.2.0-beta.1`).

**Trigger (manual):** _Actions → Release → Run workflow_, supplying a version
tag and an optional "pre-release" checkbox.

#### Jobs

| Job | Runner | Artifacts |
|-----|--------|-----------|
| `build-sfu` (× 3) | ubuntu-latest | `sfu-linux-amd64.zip`, `sfu-linux-arm64.zip`, `sfu-windows-amd64.zip` — standalone SFU binaries |
| `build-server` (× 2) | ubuntu-latest | `gryt-server-linux-x64-v<ver>.zip`, `gryt-server-windows-x64-v<ver>.zip` — full self-hosted server bundles (server + SFU + image-worker) |
| `build-client-linux` | ubuntu-latest | `Gryt-Chat-<ver>-linux-x64.AppImage`, `Gryt-Chat-<ver>-linux-x64.deb`, `latest-linux*.yml` |
| `build-client-windows` | windows-latest | `Gryt-Chat-<ver>-win-x64.exe` (NSIS installer), `Gryt-Chat-<ver>-win-x64-portable.exe`, `latest.yml` |
| `github-release` | ubuntu-latest | Creates the GitHub Release and attaches all artifacts from the jobs above |

After the GitHub Release is published the existing **`release-mac.yml`**
workflow fires automatically (via `release: published`) and attaches the signed
& notarised macOS DMG / ZIP using the self-hosted macOS runner.

---

## How to cut a release

### Option A — Tag-based (recommended)

```bash
# Make sure you are on main and everything is merged
git checkout main && git pull

# Create and push a signed tag
git tag -s v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

The `release.yml` workflow starts automatically.  Follow the run at
**Actions → Release** in the repository.

For a **pre-release / beta**, append a pre-release identifier:

```bash
git tag -s v1.2.3-beta.1 -m "Beta v1.2.3-beta.1"
git push origin v1.2.3-beta.1
```

Tags containing a hyphen (e.g. `-beta`, `-rc`) are automatically marked as
pre-releases on GitHub.

### Option B — Manual dispatch

1. Go to **Actions → Release → Run workflow** in the GitHub UI.
2. Enter the version tag (e.g. `v1.2.3`).
3. Optionally check **Mark as pre-release**.
4. Click **Run workflow**.

---

## Required secrets

| Secret | Used by | Description |
|--------|---------|-------------|
| `GH_PAT` | `build.yml`, `release.yml`, `release-mac.yml` | A personal access token (classic) with `repo` scope — needed to clone private submodules (`packages/client`, `packages/server`, `packages/sfu`, `packages/image-worker`). |
| `MACOS_CERT_P12_BASE64` | `release-mac.yml` | Base-64-encoded Apple Developer `.p12` signing certificate. |
| `MACOS_CERT_PASSWORD` | `release-mac.yml` | Password for the `.p12` certificate. |
| `APPLE_API_KEY_P8_BASE64` | `release-mac.yml` | Base-64-encoded App Store Connect API key (`.p8` file) used for notarisation. |
| `APPLE_API_KEY_ID` | `release-mac.yml` | App Store Connect API Key ID. |
| `APPLE_API_ISSUER` | `release-mac.yml` | App Store Connect API Issuer ID. |
| `DISCORD_RELEASE_WEBHOOK_URL` | `discord-release-notify.yml` | Optional — Discord webhook for release announcements. Leave unset to skip. |

Set these at **Settings → Secrets and variables → Actions** in the repository.

---

## Caching strategy

| Component | Cache mechanism |
|-----------|----------------|
| Client (pnpm) | `actions/setup-node` pnpm cache keyed on `pnpm-lock.yaml` |
| Server (npm) | `actions/setup-node` npm cache keyed on `package.json` |
| SFU (Go) | `actions/setup-go` module cache keyed on `go.sum` |

---

## Artifact retention

Intermediate build artifacts (uploaded between jobs) are retained for **1 day**
and are only used to assemble the final GitHub Release.  The release assets
themselves live permanently on the GitHub Release.
