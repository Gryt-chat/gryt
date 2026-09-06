## ops/

Operational scripts and deployment artifacts.

### For self-hosters (public)

- `ops/deploy/host/compose.yml` — production-style Docker Compose stack (Cloudflare Tunnel friendly)
- `ops/deploy/compose/prod.yml`, `beta.yml`, `dev.yml`, `dev-deps.yml` — additional compose stacks used during development/testing
- `ops/helm/gryt/*` — Kubernetes Helm chart

### For contributors (public)

- `ops/start_dev.sh` — local development launcher
- `ops/dev/*` — helper scripts for dev workflows

### Internal (project-owned infrastructure)

- `ops/internal/*` — used to run the project’s own hosted services (e.g. `gryt.chat`, `docs.gryt.chat`, `feedback.gryt.chat`)
- `ops/deploy/compose/*.local.yml` — overrides merged on top of the stack file next to them, for the box the project runs itself. Anything that assumes that box goes here and not in the stack file. The journald log driver is one: it needs systemd, and Docker won't start a container with it on a host that hasn't got it.
