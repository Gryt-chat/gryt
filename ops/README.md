## ops/

Operational scripts and deployment artifacts.

### For self-hosters (public)

- `ops/deploy/host/compose.yml` — production-style Docker Compose stack (Cloudflare Tunnel friendly)
- `ops/deploy/compose/*` — additional compose stacks used during development/testing
- `ops/helm/gryt/*` — Kubernetes Helm chart

### For contributors (public)

- `ops/start_dev.sh` — local development launcher
- `ops/dev/*` — helper scripts for dev workflows

### Internal (project-owned infrastructure)

- `ops/internal/*` — used to run the project’s own hosted services (e.g. `gryt.chat`, `docs.gryt.chat`, `feedback.gryt.chat`)
