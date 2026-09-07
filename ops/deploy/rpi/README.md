# The Raspberry Pi that serves the web

`gryt.chat`, `docs.gryt.chat`, `ui.gryt.chat`, `app.gryt.chat` and
`beta.gryt.chat` all run on one Pi. This directory is what runs them.

Until now these four files existed **only on the Pi**, in `/home/sivert/gryt/`,
untracked. That meant no history, no review, and no copy anywhere if the SD card
died. They are here now; the Pi still runs from its own copies, and adopting a
change is a deliberate step (below).

| File | Where it lives on the Pi |
|---|---|
| `update.sh` | `/home/sivert/gryt/update.sh` |
| `compose.yml` | `/home/sivert/gryt/compose.yml` |
| `gryt-update.service` | `/etc/systemd/system/gryt-update.service` |
| `gryt-update.timer` | `/etc/systemd/system/gryt-update.timer` |

## How it works

The timer fires every five minutes. `update.sh` takes a `flock` so two runs
never overlap, then walks the services in order:

1. **`site`, `docs`, `ui`** are built from source. Each has its own clone under
   `/home/sivert/gryt/<name>`. The script fetches, refuses anything that isn't a
   clean fast-forward, builds, and only writes `.deployed/<name>.sha` once the
   container is up. A failure leaves the running container alone and backs off —
   5 minutes, then 10, 20, 40, capped at 6 hours for the same commit.
2. **`app` and `beta`** are images, not builds. There is no commit to compare, so
   it pulls the tag and restarts only if the image id moved. They go last so a
   slow source build never delays a client release.

## What went wrong on 2026-09-07, and what stops it now

A `bun install` inside the `ui` build wedged after printing
`Slow filesystem detected`. Nothing had a timeout, so:

- the build sat there for **1h45m** with the machine idle at 0.78 load,
- it held the `flock` the whole time,
- every subsequent timer firing exited immediately on `flock -n`,
- so `site` and `docs` — quick builds, with six merged pull requests waiting —
  were never checked again.

Nothing failed. `systemctl is-active` said `activating`, which is exactly what a
healthy long build says.

Two changes, deliberately belt and braces:

- **`BUILD_TIMEOUT=40m` in `update.sh`.** One stuck build is killed, counted as a
  failure so it lands on the retry backoff, and **the services after it in the
  same run still get their turn**. This is the one that matters: it means a
  wedged `ui` no longer costs `site` and `docs` anything.
- **`TimeoutStartSec=2h` on the unit.** `Type=oneshot` defaults to
  `infinity`, which is why systemd was content to wait forever. This catches a
  hang somewhere the script's own timeout does not cover.

The log now distinguishes the two, because they have different causes — a build
that *fails* is usually the source, and one that *hangs* is usually the box:

```
[…] [ui] BUILD TIMED OUT after 40m; running container untouched
[…] [ui] BUILD FAILED; running container untouched
```

## Adopting a change from here

The Pi does not pull this directory. Copy deliberately, and watch one cycle
before walking away:

```bash
scp ops/deploy/rpi/update.sh rpi:/home/sivert/gryt/update.sh
ssh rpi 'chmod +x /home/sivert/gryt/update.sh'
```

For the units, which need root:

```bash
scp ops/deploy/rpi/gryt-update.service ops/deploy/rpi/gryt-update.timer rpi:/tmp/
ssh rpi 'sudo install -m644 /tmp/gryt-update.{service,timer} /etc/systemd/system/ \
  && sudo systemctl daemon-reload'
```

Then watch a run rather than assuming:

```bash
ssh rpi 'systemctl start gryt-update.service; journalctl -u gryt-update.service -f'
```

## Things worth knowing before touching it

- **Never `docker system prune` here.** The build caches are what keep a Pi
  build to minutes rather than an hour.
- **A build failure is not a deploy failure.** The running container is left
  alone on purpose; a site that is an hour stale beats a site that is 502.
- **`.deployed/<name>.sha` is the record**, not the git checkout. A checkout can
  be ahead of what is actually serving if a build failed after the fast-forward.
- The clones under `/home/sivert/gryt/<name>` are **not** the superproject's
  submodules. They are separate shallow clones, one per deployed service.
