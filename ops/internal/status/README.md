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

It lives at `/opt/gryt-status` on the VPS. Copy this folder there and bring it
up:

```bash
scp -r ops/internal/status/* vps:/opt/gryt-status/
ssh vps 'cd /opt/gryt-status && docker compose up -d'
```

Gatus reloads the config on its own when a file in the directory changes, so a
config edit needs nothing else. It only needs a restart when the compose file or
the image changes:

```bash
ssh vps 'cd /opt/gryt-status && docker compose up -d'
```

This file used to say a change needed a restart. It doesn't, and the console
below depends on that being true.

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
