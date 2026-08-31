# community.gryt.chat

The one Gryt server we run ourselves. Internal infrastructure, like the rest of
`ops/internal`. If you are standing up your own server, use
[`gryt`](https://get.gryt.chat) or the files under `ops/deploy`, which are
written for that.

It runs on `gryt-community`, a VM under Astro that is cut off from everything
else here. It reaches the public internet and nothing on any private network:
not the LAN, not another VM, not Astro itself, not the other WireGuard peers.
A public server invites strangers, and this is the one machine here somebody
might get a shell on.

## Shape

```
    client
      │  HTTP over the Cloudflare tunnel
      │  media as UDP 10000 to the VPS address
      ▼
    VPS 193.200.238.156
      │  DNAT udp/10000 -> 10.2.0.6, over WireGuard
      ▼
    VM gryt-community  (192.168.122.213 on virbr0, 10.2.0.6 on wg0)
      └─ compose: server, sfu, minio, image-worker, cloudflared
```

Everything the VM sends leaves through the VPS (`AllowedIPs = 0.0.0.0/0`). That
is not about privacy. Media arrives DNAT'd with the client's own public address
as the source, and a reply that went out the house connection instead would
reach the client from an address it never negotiated. It also makes
`ICE_ADVERTISE_IP` one true value rather than something to keep verifying —
GRYT-768 was the other arrangement drifting out of step, unnoticed for weeks
because calls kept connecting on a candidate nobody had chosen.

| | Where | Reachable from |
|---|---|---|
| Server HTTP | `server:5000` on the compose network | `community.gryt.chat`, via cloudflared |
| SFU signalling | `sfu:5005` on the compose network | `community-sfu.gryt.chat`, via cloudflared |
| SFU media | `0.0.0.0:10000/udp` on the VM | the VPS address, DNAT'd over WireGuard |
| MinIO | compose network | nothing |
| Metrics | compose network | nothing |

`127.0.0.1:5020` and `127.0.0.1:5025` are also published on the VM. Those are
for debugging from inside it; cloudflared reaches the services by name.

## Isolation

Three layers. Only the first is enforcement.

**Astro** — [`astro-isolation.sh`](astro-isolation.sh), deployed to
`/boot/config/gryt-community-isolation.sh`, called from `/boot/config/go` and
re-run every ten minutes by cron. `FORWARD` rules stop the guest subnet routing
to any private network, and `INPUT` rules stop it reaching Astro itself.

Two things about that file are load-bearing. It does not use `LIBVIRT_FWO`,
where libvirt would put its rules, because `FORWARD` on Astro has blanket
`ACCEPT all` rules well above the `LIBVIRT_*` jumps and nothing added there is
ever reached. And it is on cron because Unraid runs from RAM and a Docker
restart rewrites the top of `FORWARD` — the failure mode is silent, the VM
simply comes back reachable.

**The VPS** — `wg0 -> wg0 DROP` for peer to peer, plus `INPUT` rules for
`10.2.0.6`. Peer isolation is a `FORWARD` rule, so on its own it misses traffic
addressed to the hub, and the community peer could open the VPS's own sshd.

**The guest** — `/etc/nftables.conf`, defence in depth. A rooted guest can
flush it, so it is there for the case where something on a host is wrong, not
as the thing being relied on.

To check it, from inside the VM with its own rules removed:

```bash
sudo nft delete table inet gryt_isolation
ping -c1 -W2 192.168.50.168     # must fail
curl -s -o /dev/null https://ghcr.io/v2/   # must work
sudo systemctl restart nftables
```

## Two things that will bite

**The media port is 10000, not 3478.** The SFU's own documentation recommends
3478 and it is the right answer nearly everywhere. Measured against this VPS on
2026-08-31: inbound UDP 3478 never arrives. Nor does 3479, 5349, 5000, 8443,
20000, 30000, 33434, 40000, 49152, 51820 or 60000. 443, 4443, 10000 and 10001
do. Nothing on the VPS drops them — a counter in `mangle PREROUTING`, ahead of
every other rule, stays at zero — so the filtering is upstream of the box. Worth
re-testing if the VPS or its provider changes, because 3478 is the better port
for anyone behind a corporate or school firewall.

The rule also has to be *inserted* rather than appended: 10000 sits inside the
`1024:65000` range the VPS forwards to the other peer, so an appended rule never
matches.

**`SERVER_PASSWORD` is not the join password here.** `join_policy` decides who
gets in. This value is the HMAC key the server signs SFU client tokens with and
the secret it registers with the SFU under, so it has to be strong and it has to
stay between the two services. GRYT-786 covers the fact that it defaults to
empty everywhere else.

`nftables.service` on Debian stops with `nft flush ruleset`,
which deletes every table on the box — wg-quick's kill-switch and Docker's
chains included. `/etc/systemd/system/nftables.service.d/no-global-flush.conf`
on the VM replaces that with a delete of one table by name. Without it, a
Docker restart came back with `No chain/target/match by that name` and the stack
would not start.

## Standing it up

```bash
ssh -J unraid sivert@192.168.122.213
sudo install -d -o sivert -g sivert /opt/gryt-community
# copy compose.yml, backup.sh and .env.example from this directory
cp .env.example .env    # fill in every blank
docker compose up -d
docker compose --profile tunnel up -d    # once CLOUDFLARE_TUNNEL_TOKEN is set
```

The tunnel's ingress in the Zero Trust dashboard points at `http://server:5000`
and `http://sfu:5005`, since cloudflared runs on the compose network.

`community-sfu.gryt.chat`, one label deep. Cloudflare's universal certificate
covers `*.gryt.chat` and stops there, so `sfu.community.gryt.chat` would need
Advanced Certificate Manager and the failure is a TLS error at the edge that
nothing in Gryt's logs mentions.

## Backups

`backup.sh` runs nightly through the systemd units in `systemd/`, writes to
`/var/backups/gryt-community`, and keeps 31 days.

It takes the database with `sqlite3 .backup` rather than `cp`, because a live
SQLite database has data in the WAL that a file copy does not see, and the
result restores cleanly, so nothing tells you the last few minutes are gone.
Uploads go through `mc mirror`, so the copy is a consistent view of the bucket
rather than files caught mid-write.

Both copies land on the same disk as the thing they back up. Nothing copies
them off the VM yet.
