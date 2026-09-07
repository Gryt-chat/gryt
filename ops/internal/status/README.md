# ops/internal/status

The public status page at [status.gryt.chat](https://status.gryt.chat). It runs
[Gatus](https://github.com/TwiN/gatus) and watches Gryt from the outside.

## Why it isn't on the Docker host at home

Everything it watches is served from home through a Cloudflare tunnel. A status
page sitting next to those services would go dark at the same moment they do,
which is the one moment anybody looks at it. So it runs on the Gigahost VPS
instead, on its own Cloudflare tunnel, and it checks the public hostnames rather
than internal ports. What the page reports is what a user gets, tunnel and CDN
included.

## Every check asserts on the body

A status code can't tell a working service from an error page standing where the
service used to be. Anything answering on the hostname returns a code, and so
does an edge that puts its own page up when the origin is gone. So each check
also names something only the real service serves: a title, an issuer, a JSON
field.

It wasn't always like that. Until 2026-09-03 most checks were `[STATUS] < 400`
and nothing else, so a page that wasn't the service passed.

If you add an endpoint, give it a body condition. To check the condition does
any work, break it on purpose and confirm the endpoint goes red.

## What it deliberately doesn't watch

Only hosts under `gryt.chat`. Nothing personal, nothing on another domain.

The demo server is for store review. This page is for people using Gryt.

The community server belongs here once it has a DNS record. It's the default
server in the client and it's named on the site, so it's the one server a user
has a reason to see the state of. Tracked as GRYT-873.

## Deploying

It polls, like the Pi does. Merge to `main` and the box picks it up within five
minutes — `gryt-status-update.timer` runs `update.sh`, which fast-forwards a
clone at `/opt/gryt-src`, copies the config and compose file across, and pulls
`ghcr.io/gryt-chat/console`. Nothing is built here.

This used to be `scp`, and merging changed nothing on the box until somebody
remembered. Gryt-chat/gryt#223 merged and the VPS carried on running the old
compose file, which is what prompted the timer.

First-time setup, or after changing the units:

```bash
ssh vps 'git clone --depth 1 https://github.com/Gryt-chat/gryt.git /opt/gryt-src'
scp ops/internal/status/update.sh vps:/opt/gryt-status/update.sh
scp ops/internal/status/gryt-status-update.{service,timer} vps:/tmp/
ssh -t vps 'sudo mv /tmp/gryt-status-update.{service,timer} /etc/systemd/system/ \
  && sudo systemctl daemon-reload \
  && sudo systemctl enable --now gryt-status-update.timer'
```

Watching it:

```bash
ssh vps 'systemctl list-timers gryt-status-update --all'
ssh vps 'journalctl -u gryt-status-update -n 40 --no-pager'
```

To force a cycle rather than wait:

```bash
ssh vps 'sudo systemctl start gryt-status-update'
```

### What it will not touch

`.env` and `config/announcements.yaml`. The first holds
`CONSOLE_PASSWORD_HASH`, the second is written by the console, and neither is
in git — so the sync copies named files rather than the directory. A wholesale
copy would delete the password hash and lock everybody out of the console
during whatever it was that needed announcing.

### It validates before it replaces

A bad config stops Gatus and the status page goes with it, so `update.sh` runs
the new config in a throwaway container first and keeps the old one if it does
not come back with `Validated`. Checked on the VPS in both directions: a good
config passes the gate, a config with broken YAML is rejected, and `--rm` means
neither leaves a container behind.

## Announcing an outage

The console at `status.gryt.chat/console` posts announcements — Gatus renders
them at the top of the page, and the Gryt client shows the same words as a
banner to everybody signed in. One place to post, so the page and the banner
cannot disagree.

It lives in its own repository, [Gryt-chat/console][console], and is pulled
here as an image rather than built on this box. It writes
`config/announcements.yaml`, which Gatus merges with `config.yaml` because
`GATUS_CONFIG_PATH` is a directory and arrays are appended. Nothing touches
`config.yaml`, and nothing restarts.

[console]: https://github.com/Gryt-chat/console

Updating it:

```bash
ssh vps 'cd /opt/gryt-status && docker compose pull console && docker compose up -d console'
```

The password, the tunnel route and how the path prefix works are all documented
in that repository's README.

## Validate before you deploy

A bad config stops the container, and the page goes down with it. Run the config
in a throwaway container first and read what it says:

```bash
ssh vps 'timeout 25 docker run --rm --pull=never \
  -v /opt/gryt-status/config/config.yaml.new:/config/config.yaml:ro \
  -v /tmp/gatus-validate:/data \
  twinproduction/gatus:v5.36.0 2>&1 | grep -E "Validated|success="'
```

It prints how many endpoints parsed, then runs every check once, so a typo in a
body condition shows up as `success=false` before it reaches the live page.

Don't grep that output for the word `errors`. Every passing line ends in
`errors=0`.

Use `--rm` and a `timeout`, as above. A validation run on 2026-09-03 was still
running four days later as `infallible_zhukovsky`, holding
`config/config.yaml.new` and serving nothing, because it was started without
either. Check `docker ps` on the VPS after validating.

The console does not need this. It writes JSON, which is valid YAML, so the
message somebody typed cannot produce a malformed file the way hand-built YAML
quoting can.

## Reading it

The page is at status.gryt.chat. The JSON behind it is at
`/api/v1/endpoints/statuses`, which is easier to read from a terminal:

```bash
curl -s https://status.gryt.chat/api/v1/endpoints/statuses | jq -r '.[] | "\(.group) \(.name) \(.results[-1].success)"'
```

History is SQLite in the `gatus-data` volume, so it survives a restart but not a
`compose down -v`.
