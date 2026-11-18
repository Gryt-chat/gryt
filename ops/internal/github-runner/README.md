# GitHub runner for the private repos

Actions minutes on a private repo count against the org's quota, and public repos
are free. So the private repos run their jobs here instead of on GitHub's machines:
`rich-presence-scraper` (the daily detectable list) and `gryt-cloud` (Rust CI).

Each runner is registered to one repo. A public repo can't send it a job, which
matters, because on a public repo anyone's fork PR could run code on this box.
Never register one of these to a public repo.

The workflows pick it with `runs-on: [self-hosted, gryt-private]`. If the box is
down, those jobs wait in the queue rather than failing.

## Installing

In a directory holding these four files, on the machine that runs it:

```bash
SCRAPER_TOKEN=<token> CLOUD_TOKEN=<token> docker compose up -d --build
```

A token comes from the repo's Settings → Actions → Runners → New self-hosted
runner, or `gh api -X POST repos/Gryt-chat/<repo>/actions/runners/registration-token
--jq .token`. It lasts an hour and is only needed the first time: the registration
is kept in the `gryt-runner-*-state` volumes, so a restart or a rebuild reconnects
without one.

## Updating

GitHub updates the runner by itself. To move the base image, bump the tag in the
`Dockerfile` and run `docker compose up -d --build` again.

## Removing

```bash
docker compose down -v
```

Then remove the runner from each repo's Settings → Actions → Runners.
