# Beta Release Pipeline

All releases land on `:latest-beta`. Production (`:latest`) is only updated via promotion.

## Quick Reference

| Script | What it does |
|---|---|
| `packages/*/scripts/release.sh` | Build + push to `:latest-beta` |
| `scripts/update-beta.sh` | Pull `:latest-beta` and restart beta stack |
| `scripts/promote-beta.sh` | Re-tag `:latest-beta` → `:latest`, optionally update prod |
| `scripts/update-prod.sh` | Pull `:latest` and restart production stack |

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

Pulls the latest `:latest-beta` images and restarts the beta stack (`ops/deploy/compose/beta.yml`).

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

The beta stack runs on different ports (server: 5010, sfu: 5015, client: 3667) with its own database keyspace (`gryt_beta`) and S3 bucket (`gryt-beta`), so it can coexist alongside production on the same host.

## Configuration

- **Beta env**: `ops/deploy/compose/.env.beta` — image tags, ports, server name, DB keyspace
- **Beta compose**: `ops/deploy/compose/beta.yml` — service definitions
- **Prod env**: `ops/deploy/compose/.env.prod` — unchanged, still pulls `:latest`
- **Prod compose**: `ops/deploy/compose/prod.yml` — unchanged
