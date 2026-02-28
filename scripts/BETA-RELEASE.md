# Release Pipeline

Each release script asks you to pick a **channel**: beta or latest (production).

- **Beta** — tags Docker as `:latest-beta`, creates a GitHub prerelease, deploys to beta.
- **Latest** — tags Docker as both `:latest-beta` and `:latest`, creates a stable GitHub release, deploys to beta + production.

## Quick Reference

| Script | What it does |
|---|---|
| `packages/*/scripts/release.sh` | Build + push + deploy (picks channel at release time) |
| `scripts/update-beta.sh` | Pull `:latest-beta` and restart beta stack |
| `scripts/update-prod.sh` | Pull `:latest` and restart production stack |

## Port Mapping

| Service | Prod | Beta |
|---|---|---|
| Server | 5000 | 5010 |
| SFU | 5005 | 5015 |
| Client (web) | 3666 | 3667 |
| Image Worker (health) | 8080 | 8080 |
| NT Server | 5001 | 5011 |
| UDP range | 10000–10019 | 10020–10039 |

Beta and production can run side-by-side on the same host without port conflicts.

## Day-to-Day Workflow

### 1. Release a new version (server example)

```bash
cd packages/server
bash scripts/release.sh
```

Pick your version bump (patch/minor/major), then choose the channel:

- **1) Beta** — pushes to `:latest-beta`, creates a prerelease, deploys to beta
- **2) Latest** — pushes to `:latest-beta` AND `:latest`, creates a stable release, deploys to beta + production

Same flow for `packages/sfu/scripts/release.sh`, `packages/client/scripts/release.sh`, and `packages/image-worker/scripts/release.sh`.

### 2. Update an environment manually

```bash
bash scripts/update-beta.sh   # pull + restart beta
bash scripts/update-prod.sh   # pull + restart production
```

### 3. Iterate

Repeat step 1 with channel **Beta** as many times as needed. Each release bumps the version and updates `:latest-beta`. Production is completely unaffected.

When ready, run step 1 again with channel **Latest** to push to production.

## Starting the Beta Stack

First time only — start the beta environment:

```bash
cd ops/deploy/compose
docker compose -f beta.yml --env-file .env.beta --profile web up -d
```

Or just run `scripts/update-beta.sh` which does the same thing.

## Local Overlay (NT Server)

To add the NT server to the beta stack, the file `ops/deploy/compose/beta.local.yml` is used. It mirrors `prod.local.yml` but for the beta environment:

- NT server on port 5011 (prod uses 5001)
- Separate instance ID (`gryt_beta_nt`) and bucket (`nts-beta`)
- Uses `:latest-beta` images

`update-beta.sh` automatically detects and merges `beta.local.yml` if present. You can also run it manually:

```bash
cd ops/deploy/compose
docker compose -f beta.yml -f beta.local.yml --env-file .env.beta --profile web up -d
```

## Configuration

| File | Purpose |
|---|---|
| `ops/deploy/compose/beta.yml` | Beta service definitions |
| `ops/deploy/compose/beta.local.yml` | Local overlay (adds NT server) |
| `ops/deploy/compose/.env.beta` | Beta image tags, ports, server name, server instance settings |
| `ops/deploy/compose/prod.yml` | Production service definitions |
| `ops/deploy/compose/prod.local.yml` | Production local overlay (adds NT server) |
| `ops/deploy/compose/.env.prod` | Production config — pulls `:latest` |
