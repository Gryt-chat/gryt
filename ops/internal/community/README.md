# community.gryt.chat

The one Gryt server we run ourselves. Internal infrastructure, like the rest of
`ops/internal`. If you are standing up your own server, use
[`gryt`](https://get.gryt.chat) or the files under `ops/deploy`, which are
written for that.

It runs on the public VPS, not on the Docker host at home. Two reasons.

**ICE.** The SFU has to advertise an address the outside world can reach. On the
VPS that is the machine's own address, so `ICE_ADVERTISE_IP` is a fact about the
box rather than a value that has to stay in step with a tunnel. GRYT-768 was the
other arrangement drifting out of step: calls kept connecting, on a candidate
nobody had chosen, and it went unnoticed for weeks.

**Blast radius.** A public server invites strangers. The Docker daemon at home
runs prod, beta, the auth stack and several unrelated projects with no off-box
backups. This one should not be able to fill that disk or sit next to that
database.

## Layout

```
/opt/gryt-community/
  compose.yml     copied from here
  .env            copied from .env.example, filled in, never committed
  backup.sh       copied from here
```

Everything is on the compose bridge network. MinIO is not published at all; the
server and the SFU's signalling port are published on loopback and served
through the Cloudflare tunnel. The only thing facing the internet directly is
the media port, because the tunnel does not carry UDP and Gryt has no TURN
relay to fall back on.

| | Host | Public |
|---|---|---|
| Server HTTP | `127.0.0.1:5020` | `community.gryt.chat` (tunnel) |
| SFU signalling | `127.0.0.1:5025` | `community-sfu.gryt.chat` (tunnel) |
| SFU media | `0.0.0.0:3478/udp` | the VPS address, directly |
| MinIO | — | — |
| Metrics | — | — |

## Standing it up

```bash
ssh vps
sudo mkdir -p /opt/gryt-community && cd /opt/gryt-community
# copy compose.yml, backup.sh and .env.example from this directory
cp .env.example .env   # then fill in every value that is blank
docker compose up -d
```

## Three things that will bite

**The nftables rule that forwards everything home.** The VPS DNATs TCP and UDP
1024-65000 to the WireGuard peer at home. 3478 is inside that range, so a
container publishing it on this box never sees a packet. The rule fires first,
and the media port is dead while everything else looks fine. It needs
a rule ahead of the range one:

```bash
sudo nft insert rule ip nat PREROUTING iifname "ens18" udp dport 3478 counter accept
```

An `accept` in the nat PREROUTING chain ends the chain without translating, so
the packet stays on this machine. Add it to whatever persists the ruleset as
well, or it is gone on the next reboot.

**Cloudflare's certificate covers one label.** It covers `*.gryt.chat` and stops
there, so `sfu.community.gryt.chat` would need Advanced Certificate Manager and
`community-sfu.gryt.chat` does not. The failure is a TLS
error at the edge, so nothing in Gryt's logs mentions it.

**`SERVER_PASSWORD` is not the join password here.** `join_policy` decides who
gets in. This value is the HMAC key the server signs SFU client tokens with and
the secret it registers with the SFU under, so it has to be strong and it has to
stay between the two services.

## Backups

`backup.sh` runs nightly through the systemd units in `systemd/`, writes to
`/var/backups/gryt-community`, and keeps 31 days.

It takes the database with `sqlite3 .backup` rather than `cp`, because a live
SQLite database has data in the WAL that a file copy does not see, and the
result restores cleanly, so nothing tells you the last few minutes are gone.
Uploads go through `mc mirror`, so the copy is a consistent view of the bucket
rather than files caught mid-write.

Both copies land on the same disk as the thing they back up. Nothing copies
them off the VPS yet.
