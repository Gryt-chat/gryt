# ops/internal/tunnel-alert

Posts to Discord when one of Gryt's WireGuard tunnels on the VPS goes down, and
again when it comes back. It's private. Nothing about it shows up on
status.gryt.chat.

## Why it exists

Voice media reaches home as UDP through WireGuard on the VPS (`ssh vps`), and no
HTTP check sees that path. In September 2026 a tunnel was down for eight days
while every check on the status page read green, and nobody off the LAN could
hear anybody.

The status page used to watch the tunnels with *Voice calls* and *Community
voice calls*. Those came off in Gryt-chat/gryt#264, because a public "Voice
calls" row read like Gryt runs voice for everyone. This is what watches them now.

## What it checks

Every minute, `tunnel-alert.sh` reads `wg show wg0 dump` and looks at the last
handshake for two peers:

- `10.2.0.5`, the dev box, which carries prod and beta voice
- `10.2.0.6`, the community VM

The other peers on `wg0` aren't Gryt's, so it leaves them out.

With keepalive at 25 seconds a live peer rekeys about every two minutes. So a
peer counts as down once its last handshake is 5 minutes old, or once it's been
missing from `wg0` for 5 minutes. If `wg` fails outright, both peers count as
missing.

It posts once when a peer goes down and once when it recovers, with how long it
was down. State is one file per peer in `/var/lib/gryt-tunnel-alert/`. If a
post fails, it tries again on the next run.

## How it's deployed

The service runs the script straight out of `/opt/gryt-src`. That's the clone
`gryt-status-update.timer` fast-forwards every five minutes (see
[`../status/README.md`](../status/README.md)), so a merged change to the script
is live within five minutes and nothing gets copied.

The units and the webhook file are a one-off install.

The webhook goes in `/etc/gryt-tunnel-alert.env`, owned by root, mode 600:

```
TUNNEL_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

It never goes in git. The script passes it to curl on stdin, so it doesn't
show up in `ps` or the journal either.

### Installing

From a checkout of `main`:

```bash
scp ops/internal/tunnel-alert/gryt-tunnel-alert.{service,timer} vps:/tmp/
ssh -t vps 'sudo mv /tmp/gryt-tunnel-alert.{service,timer} /etc/systemd/system/ \
  && sudo systemctl daemon-reload \
  && sudo systemctl enable --now gryt-tunnel-alert.timer'
```

Then the webhook. This asks for the URL without echoing it, and nothing is
written to shell history:

```bash
ssh -t vps 'read -rs -p "Webhook URL: " u && echo \
  && sudo install -m 600 -o root -g root /dev/null /etc/gryt-tunnel-alert.env \
  && echo "TUNNEL_ALERT_WEBHOOK_URL=$u" | sudo tee /etc/gryt-tunnel-alert.env >/dev/null \
  && sudo bash /opt/gryt-src/ops/internal/tunnel-alert/tunnel-alert.sh --test'
```

The shell on the VPS is bash, so `read -p` works there.

## Testing it

`--test` posts one message and does nothing else:

```bash
ssh vps 'sudo bash /opt/gryt-src/ops/internal/tunnel-alert/tunnel-alert.sh --test'
```

It prints the HTTP status. Discord answers 204 when the post went through.

To see what it's deciding:

```bash
ssh vps 'systemctl list-timers gryt-tunnel-alert --all'
ssh vps 'journalctl -u gryt-tunnel-alert -n 20 --no-pager'
ssh vps 'sudo ls -l /var/lib/gryt-tunnel-alert/'
```

It logs nothing while both peers are healthy. A down peer logs a line every
minute, and the state file holds `<down since> <alerted>`.

To try the logic somewhere other than the VPS, point it at a fake `wg` and a
fake clock. `TUNNEL_ALERT_WG` is a command that prints a dump,
`TUNNEL_ALERT_NOW` is the time in epoch seconds, and `TUNNEL_ALERT_STATE` and
`TUNNEL_ALERT_ENV` move the state directory and the env file:

```bash
TUNNEL_ALERT_WG=./fake-wg TUNNEL_ALERT_NOW=2000000300 \
  TUNNEL_ALERT_STATE=/tmp/ta-state TUNNEL_ALERT_ENV=/tmp/ta.env \
  bash tunnel-alert.sh
```

It needs bash 4 or newer, so on a Mac run it with Homebrew's bash or in a
Debian container.

## What it won't catch

A dead timer tells nobody. If `gryt-tunnel-alert.timer` stops, the alerts stop
with it. `systemctl list-timers` shows whether it's still firing.

It also can't see a tunnel that handshakes fine but drops media, since a
handshake only proves the peers can reach each other.
