# Beta Release Pipeline

All releases land on `:latest-beta`. Production (`:latest`) is only updated via promotion.

## Quick Reference

| Script | What it does |
|---|---|
| `packages/*/scripts/release.sh` | Build + push to `:latest-beta` |
| `scripts/update-beta.sh` | Pull `:latest-beta` and restart beta stack |
| `scripts/promote-beta.sh` | Re-tag `:latest-beta` → `:latest`, optionally update prod |
| `scripts/update-prod.sh` | Pull `:latest` and restart production stack |

## Port Mapping

| Service | Prod | Beta |
|---|---|---|
| Server | 5000 | 5010 |
| SFU | 5005 | 5015 |
| Client (web) | 3666 | 3667 |
| NT Server | 5001 | 5011 |
| UDP range | 10000–10019 | 10020–10039 |

Beta and production can run side-by-side on the same host without port conflicts.

## Versioning

Each beta release **bumps the patch number** and appends `-beta`:

```
Prod release:    1.0.95
1st beta patch:  1.0.96-beta
2nd beta patch:  1.0.97-beta
3rd beta patch:  1.0.98-beta
Promote to prod: 1.0.98          (drop the -beta suffix)
```

The gap between production version numbers (95 → 98) tells you exactly how many beta iterations happened. Minor/major bumps work the same way — e.g. `1.1.0-beta`, `1.1.1-beta`, etc.

## Day-to-Day Workflow

### 1. Release a new version (server example)

```bash
cd packages/server
bash scripts/release.sh
```

Pick your version bump (patch/minor/major). The script will:
- Bump the version in `package.json`
- Build the Docker image
- Push to `ghcr.io/gryt-chat/server:latest-beta` (and the versioned tags)
- Commit + create a GitHub release

Same flow for `packages/sfu/scripts/release.sh` and `packages/client/scripts/release.sh`.

### 2. Update the beta server

```bash
bash scripts/update-beta.sh
```

Pulls the latest `:latest-beta` images and restarts the beta stack (`ops/deploy/compose/beta.yml`). If `beta.local.yml` exists, it is automatically merged (adds the NT server).

### 3. Iterate

Repeat steps 1-2 as many times as needed. Each release bumps the version and updates `:latest-beta`. Production is completely unaffected.

### 4. Promote to production

Once you're happy with beta:

```bash
bash scripts/promote-beta.sh
```

This will:
1. Pull `:latest-beta` for server, sfu, and client
2. Re-tag each as `:latest`
3. Push `:latest` to the registry
4. Ask if you want to run `update-prod.sh` to restart production

No rebuild needed — the exact same images you tested in beta go to production.

## Starting the Beta Stack

First time only — start the beta environment:

```bash
cd ops/deploy/compose
docker compose -f beta.yml --env-file .env.beta --profile web up -d
```

Or just run `scripts/update-beta.sh` which does the same thing.

## Local Overlay (NT Server)

To add the NT server to the beta stack, the file `ops/deploy/compose/beta.local.yml` is used. It mirrors `local.yml` but for the beta environment:

- NT server on port 5011 (prod uses 5001)
- Separate keyspace (`gryt_beta_nt`) and bucket (`nts-beta`)
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
| `ops/deploy/compose/.env.beta` | Beta image tags, ports, server name, DB keyspace |
| `ops/deploy/compose/prod.yml` | Production service definitions (unchanged) |
| `ops/deploy/compose/local.yml` | Production local overlay (unchanged) |
| `ops/deploy/compose/.env.prod` | Production config — pulls `:latest` (unchanged) |
