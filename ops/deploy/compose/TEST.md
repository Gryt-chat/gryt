# The test server

`test.yml` runs the Gryt server that the nightly end-to-end tests (GRYT-1227) connect to. It's a Compose project called `gryt-test` on dev.lan, beside prod and beta, with its own containers, SFU, UDP port, volume and image worker. It runs the `latest` images, so the tests always hit the current release. Guests can join, but only with the invite.

## How it's reached

| What | From outside | On dev.lan |
|------|--------------|------------|
| Server | `https://test.gryt.chat` | `5030`, host networking |
| SFU signalling | `wss://test-sfu.gryt.chat` | `5035`, published to the container's `5005` |
| SFU media | UDP `193.200.238.156:10002` | UDP `10002` |
| SFU registration | not reachable | `127.0.0.1:9195` |
| SFU metrics | not reachable | `127.0.0.1:9095` |
| Image worker health | not reachable | `127.0.0.1:8086` |

Both hostnames are routes on the Cloudflare tunnel that serves `ws1.sivert.io`. `test.gryt.chat` goes to `http://dev.lan:5030` and `test-sfu.gryt.chat` goes to `http://dev.lan:5035`. They're set up in the Cloudflare dashboard. Nothing in this repository manages them.

Voice media skips Cloudflare. The SFU tells clients to send UDP to the VPS at `193.200.238.156`, port 10002. A DNAT rule on the VPS forwards that port over WireGuard to dev.lan (`10.2.0.5`), and Docker passes it on to the SFU. The rule lives in `/etc/wireguard/wg0.conf` on the VPS as a `PostUp` line, next to the one for beta's 4443. It has to name 10002 on its own, because the catch-all rule for UDP 1024-65000 sends traffic to a different WireGuard peer.

The VPS is at Gigahost, and Gigahost's firewall only lets a few UDP ports through to it. The range for SFU media is 10000-10020. community.gryt.chat has 10000 and this server has 10002. Prod's SFU gets through on 443, which is also on the list. That firewall lives in Gigahost's control panel, so nothing on the VPS shows it, and a blocked port never arrives. This server first used 4444, and no call from outside the LAN ever connected (GRYT-1233).

Beta's 4443 is outside the range too, so beta voice from outside the LAN probably doesn't connect either. Moving beta to 10001 is GRYT-1234.

If voice never gets past connecting, check two things on the VPS. The rule should be listed, and a few packets sent to port 10002 from outside should show up in conntrack:

```bash
sudo iptables -t nat -S PREROUTING | grep 10002
sudo grep 'dport=10002 ' /proc/net/nf_conntrack
```

A call from the LAN won't tell you whether any of that works. The SFU only advertises the VPS address, but a browser at home also sends the SFU its LAN address, and the SFU reaches it straight over the LAN. To test the VPS path from home, stop the browser's own candidates reaching the SFU, for example by dropping them in `onicecandidate`.

The server's metrics are off (`METRICS_PORT=0`). It uses host networking, so a metrics port would be open to the whole LAN.

## Starting and stopping

On dev.lan, from `/home/sivert/gryt/ops/deploy/compose`. Always name the project, so nothing else on the box gets touched:

```bash
docker compose -p gryt-test -f test.yml --env-file .env.test up -d
docker compose -p gryt-test -f test.yml --env-file .env.test stop
```

`.env.test` holds `JWT_SECRET` and nothing else, and `.env.test.example` shows the format. It's gitignored, so a pull won't overwrite it.

Logs go to journald, so they're still there after a reset. Read them with `journalctl CONTAINER_NAME=gryt-test-server`.

## Resetting

```bash
./test-reset.sh
```

This pulls the latest images and removes the `gryt-test-*` containers and the `gryt-test-server-data` volume. Then it copies the seed back in and starts the stack. The seed is a copy of the data volume from right after the invite was made. So a reset gives you a server with an owner, the invite and nothing else. The script won't run if a container or volume it would delete belongs to another project.

- `./test-reset.sh --empty` does the same without the seed. Nobody owns the server afterwards, and whoever joins first becomes the owner.
- `./test-reset.sh --save-seed` stops the server for a few seconds and copies its data into the `gryt-test-seed` volume. The next reset starts from there.

## The invite

The tests join with one invite that never expires and has no use limit. Its code is in `/home/sivert/gryt-test.env` on dev.lan, outside the checkout, with mode 600:

```
GRYT_TEST_SERVER_URL=https://test.gryt.chat
GRYT_TEST_INVITE_CODE=<the code>
```

Both are also GitHub Actions secrets on `Gryt-chat/client`, under the same names.

There's no environment variable for an invite code. Invites are rows in the server's database, and the owner makes them in Server settings → Invites. To rotate the code:

1. Run `./test-reset.sh --empty`, then join `test.gryt.chat` from a client straight away. Whoever joins first owns the server.
2. In Server settings → Invites, turn on Infinite uses and leave Expires empty. Paste the output of `openssl rand -hex 16` into Custom code, then create the invite.
3. Run `./test-reset.sh --save-seed`, so later resets bring this invite back.
4. Put the new code in `/home/sivert/gryt-test.env` and in the `GRYT_TEST_INVITE_CODE` secret.

The old code stops working at step 1, and the nightly run fails until step 4 is done.
