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
      ├─ cloudflared, as a systemd service on the VM   -> out the house connection
      └─ compose: server, sfu, minio, image-worker      -> out through the VPS
```

| | Where | Reachable from |
|---|---|---|
| Server HTTP | `127.0.0.1:5020` on the VM | `community.gryt.chat`, via cloudflared |
| SFU signalling | `127.0.0.1:5025` on the VM | `community-sfu.gryt.chat`, via cloudflared |
| SFU media | `0.0.0.0:10000/udp` on the VM | the VPS address, DNAT'd over WireGuard |
| MinIO | compose network | nothing |
| Metrics | compose network | nothing |

`127.0.0.1:5020` and `127.0.0.1:5025` are how cloudflared reaches the two
services. It runs as a systemd unit on the VM rather than in the compose
project, so it is not on the compose network and cannot resolve `server` or
`sfu`. Those two ports are load-bearing, not debug conveniences.

## Egress

Containers reach the internet through the VPS. The VM's own traffic goes out
the house connection, and that includes cloudflared.

Containers need the VPS for two reasons. Media arrives DNAT'd with the client's
own public address as the source, and a reply that left through the house
connection would reach the client from an address it never negotiated. And a
link preview shouldn't show the house address to whatever site somebody linked.
It also keeps `ICE_ADVERTISE_IP` one true value. GRYT-768 was the other
arrangement drifting out of step, unnoticed for weeks because calls kept
connecting on a candidate nobody had chosen.

cloudflared goes direct because it holds up better that way. Through the tunnel
it ran QUIC inside WireGuard and logged 36 to 205 errors a day. Direct, it logged
19. A tunnel reconnect answers requests with Cloudflare's own error page, which
has no CORS header, so the client reported those as CORS errors. Cloudflare sees
the house address this way. Users and linked sites still don't.

[`egress.sh`](egress.sh) does the routing. `wg0.conf` has `Table = off` (see
[`wg0.conf.example`](wg0.conf.example)), so wg-quick adds no routes, and its
`PostUp` runs `egress.sh up`. That adds two rules for `172.16.0.0/12`, where
Docker puts its networks. The first is the main table without its default route,
so replies to the bridge and to cloudflared stay on the VM. The second is table
51820, whose only route is the tunnel. It also loads the `inet gryt_egress` nft
table, which clamps TCP MSS into wg0 and drops container traffic headed for the
house connection. A missing rule makes containers fail closed instead of leaking.

`gryt-community-egress.service` runs it before Docker at boot, and its timer runs
it every minute to put back anything that went missing. `egress.sh check` lists
what's missing. The SFU has to stay on the compose network for this to cover its
replies: with `network_mode: host` its traffic would be the VM's own.

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

## Things that will bite

**networkd deletes routing rules it didn't create.** That's its default,
`ManageForeignRoutingPolicyRules=yes`. An unattended upgrade restarted it on
2026-09-13 and wg-quick's rules went with it. For a day everything on the VM left
through the house connection, and voice replies couldn't get back to anyone.
[`systemd/networkd-foreign-rules.conf`](systemd/networkd-foreign-rules.conf),
installed as `/etc/systemd/networkd.conf.d/gryt-community.conf`, turns that off.
The egress timer is there in case something else does the same.

**Container TCP through the tunnel needs its MSS clamped.** Docker's veths are
1500 and wg0 is 1420. Without the clamp, sites that ignore ICMP stall in the TLS
handshake. The Microsoft Store page that kept turning up in the link preview
errors aborted every time through the tunnel, and loaded in half a second with
the clamp. A curl on the VM itself never shows this, because the host's sockets
already see wg0's MTU. That's why the VM could fetch a page the server couldn't.

**Some sites refuse the VPS address.** Reddit and makerworld answer 403 to a
datacenter IP, so their links come back without a card.

**The media port is 10000, not 3478.** The SFU's own documentation recommends
3478 and it is the right answer nearly everywhere. Measured against this VPS on
2026-08-31: inbound UDP 3478 never arrives. Nor does 3479, 5349, 5000, 8443,
20000, 30000, 33434, 40000, 49152, 51820 or 60000. 443, 10000 and 10001 do.
Nothing on the VPS drops them — a counter in `mangle PREROUTING`, ahead of
every other rule, stays at zero — so the filtering is upstream of the box. It's
Gigahost's firewall, and the range it allows for SFU media is 10000-10020. Worth
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
# copy compose.yml, backup.sh, egress.sh and .env.example from this directory
cp .env.example .env    # fill in every blank
```

Egress goes in before the first `docker compose up`, so no container ever starts
without it:

```bash
sudo install -m 0755 egress.sh /opt/gryt-community/egress.sh
sudo install -m 0644 systemd/gryt-community-egress.service systemd/gryt-community-egress.timer /etc/systemd/system/
sudo install -D -m 0644 systemd/networkd-foreign-rules.conf /etc/systemd/networkd.conf.d/gryt-community.conf
sudo install -m 0600 wg0.conf.example /etc/wireguard/wg0.conf   # key in /etc/wireguard/privatekey
sudo systemctl daemon-reload
sudo systemctl enable --now wg-quick@wg0 gryt-community-egress.service gryt-community-egress.timer
sudo /opt/gryt-community/egress.sh check
docker compose up -d
```

Then the tunnel, following Cloudflare's own install steps from the Zero Trust
dashboard. That installs cloudflared as a systemd unit reading
`/etc/cloudflared/token`, which is what runs today.

Its two published application routes point at `http://localhost:5020` and
`http://localhost:5025`, because a systemd cloudflared is not on the compose
network and `server` and `sfu` do not resolve there. Adding a route through the
dashboard creates the DNS record as well, so there is nothing to add by hand.

`compose.yml` still carries a `cloudflared` service behind a `tunnel` profile,
from before. It is unused. Starting it with an empty `CLOUDFLARE_TUNNEL_TOKEN`
gives a container that restarts forever with `"cloudflared tunnel run" requires
the ID or name of the tunnel`, which is what an empty token looks like. To use
it instead of the systemd unit, put the token in `.env`, `systemctl disable
--now cloudflared`, and repoint both routes at `http://server:5000` and
`http://sfu:5005`.

`community-sfu.gryt.chat`, one label deep. Cloudflare's universal certificate
covers `*.gryt.chat` and stops there, so `sfu.community.gryt.chat` would need
Advanced Certificate Manager and the failure is a TLS error at the edge that
nothing in Gryt's logs mentions.

## Staying current

The VM was found on server 1.8.3 with 1.8.8 released, because `SERVER_VERSION`
and friends in `.env` pinned exact tags and a pinned tag never moves. Same shape
as GRYT-291, where app.gryt.chat served a build five versions behind the desktop
app for weeks.

Those three variables are `latest` now, and
[`update.sh`](update.sh) pulls them from a ten-minute timer. It only ever pulls
the tag a service is already configured for, so putting a version back in `.env`
pins that service again and this stops moving it.

It recreates a container only when the tag resolves to a different image. The
first version of that check compared `docker inspect .Image` against
`docker compose images -q`, which answer in different id formats, so nothing
ever matched and every service was recreated every ten minutes. Run it twice in
a row when changing it — the second run has to say `already on`.

The SFU is left alone while anybody is in voice, since recreating it drops every
call on it. Nobody is expected to use voice on this server, but expected is not
the same as never.

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
