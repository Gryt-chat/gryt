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

- `ops/internal/*` — used to run the project’s own hosted services (e.g. `feedback.gryt.chat`, `reports.gryt.chat`, `status.gryt.chat`)
- `ops/deploy/rpi/*` — the Raspberry Pi that serves `gryt.chat`, `docs.gryt.chat`, `ui.gryt.chat` and the web clients, and the builder on Unraid it uses
- `ops/deploy/compose/*.local.yml` — overrides merged on top of the stack file next to them, for the box the project runs itself. Anything that assumes that box goes here and not in the stack file. The journald log driver is one: it needs systemd, and Docker won't start a container with it on a host that hasn't got it.
- `ops/deploy/compose/test.yml` — the server at `test.gryt.chat` that the nightly end-to-end tests run against. Nobody self-hosts it, so the journald driver and the box's addresses sit in the stack file itself. [`TEST.md`](deploy/compose/TEST.md) covers starting, resetting and the invite.
