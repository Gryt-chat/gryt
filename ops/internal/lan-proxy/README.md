# ops/internal/lan-proxy

At home, the apps reach the Gryt services on dev.lan over the LAN instead of going
out to Cloudflare and back in through the tunnel. AdGuard answers the Gryt names
with dev.lan's address, and this Caddy answers HTTPS and WSS for them with real
certificates. Each name goes to the same place the tunnel sends it.

People outside the house still use the tunnel. Nothing here changes that.

## Why

The soak test in GRYT-1325 caught a drop that only hit clients coming through the
tunnel: 25 seconds with no pings, then a reconnect. Clients reaching the server
directly never dropped. At home the apps connect to the public names, so they went
through the tunnel too, and one hiccup there dropped every server at once, for people
sitting on the same network as the servers (GRYT-1172).

## The names

Every Gryt name the tunnel sends to dev.lan. Each one goes to the same port as
through the tunnel.

| Name | dev.lan port | What it is |
|---|---|---|
| `ws1.sivert.io` | 5000 | prod server |
| `nt.sivert.io` | 5001 | prod server, nt |
| `pp.sivert.io` | 5002 | prod server, pp |
| `sfu.sivert.io` | 5005 | prod SFU signalling, which the four servers above and demo use |
| `beta.sivert.io` | 5010 | beta server |
| `beta-sfu.sivert.io` | 5015 | beta SFU signalling |
| `demo.gryt.chat` | 5020 | demo server |
| `test.gryt.chat` | 5030 | test server, for the nightly and the soak |
| `test-sfu.gryt.chat` | 5035 | test SFU signalling |
| `auth.gryt.chat` | 18080 | Keycloak, for signing in |
| `id.gryt.chat` | 18081 | identity certificates |
| `reports.gryt.chat` | 9476 | bug reports from the apps |
| `feedback.gryt.chat` | 9473 | Fider |
| `monitoring.gryt.chat` | 13000 | Grafana |

A server's socket.io connection, its API and its uploads all use the server's own
name, and each server hands out its SFU's name. Voice and video media never went
through the tunnel. It's UDP straight to the SFU.

These stay on the tunnel:

- `gryt.chat`, `app.gryt.chat`, `beta.gryt.chat`, `docs.gryt.chat`, `ui.gryt.chat`
  and `get.gryt.chat` are served from the Pi. They're pages, and the apps don't
  keep a connection open to any of them.
- `community.gryt.chat` and `community-sfu.gryt.chat` come from the community VM
  through its own tunnel. That's the second step, [below](#second-step-the-community-server).
- `status.gryt.chat` is on the VPS and was never behind the tunnel.

## How it works

- **Host networking, like cloudflared.** `dev.lan` resolves the same way for both,
  from `/etc/hosts`, and the services see connections coming from the same address
  as through the tunnel. So trusted-proxy settings mean the same thing on both paths.
- **Only 443/tcp.** 443/udp on dev.lan is the prod SFU's media port, so HTTP/3 is
  off. With it on, Caddy would advertise HTTP/3 and browsers would send QUIC to the
  SFU. There's no port 80 either: the certificates come through DNS, and the apps
  never use plain HTTP.
- **Two wildcard certificates**, `*.sivert.io` and `*.gryt.chat`, from Let's Encrypt
  through Cloudflare's DNS challenge, so nothing has to be reachable from the
  internet. Since Caddy 2.10 a site under a managed wildcard uses it rather than
  getting its own, so none of the names above end up in the CT logs.
- **The DNS challenge checks against 1.1.1.1**, because AdGuard answers these names
  with the LAN address.
- **`Cf-Connecting-Ip` is set to the real client**, the way Cloudflare sets it.
  `reports` believes that header from its trusted proxies, so without this anyone on
  the LAN could put another address in it.

The image is Caddy 2.11.4 built with `caddy-dns/cloudflare` v0.2.4, both pinned in
the `Dockerfile`. CI builds it and validates the Caddyfile inside it.

## How it differs from the tunnel

- **Clients show up with LAN addresses.** Caddy sets `X-Forwarded-For` to the LAN
  address, and the servers with `GRYT_TRUSTED_PROXY_HOPS=1` (ws1, beta, demo and
  test) read the client from there. Beta has "Allow anyone on LAN to join" on, so
  people at home get into beta without an invite now. Through the tunnel they
  arrived from the house's public address, and that setting never applied.
- **No 100 MB cap on uploads.** Cloudflare has one. The server's own limit is the
  only one here.
- **A reload closes every WebSocket going through it.** The apps reconnect within a
  second or so, but anyone in a call gets dropped, so reload when nobody's in one.

## dev.lan follows the rewrites too

dev.lan uses AdGuard for DNS, so once the rewrites are in, its own calls to these
names go through the proxy as well. The identity service fetches Keycloak's keys from
`auth.gryt.chat`, the servers fetch the identity keys from `id.gryt.chat`, and
reports and Fider sign people in through `auth.gryt.chat`.

So while the proxy is down, signing in fails for everyone, not only for people at
home. Don't leave the rewrites in with the proxy stopped. Today those same calls go
out to Cloudflare and back in through the tunnel, so they depend on the tunnel the
same way.

The community VM isn't affected. Astro resolves through 1.1.1.1, not AdGuard.

## Keeping it in step with the tunnel

Routes live in two places: the tunnel's in the Cloudflare dashboard, and the
Caddyfile here. `check-ingress.mjs` compares them. It reads the routes cloudflared
is running with from its metrics server, on `127.0.0.1:20241` on dev.lan.

On dev.lan, with the certificates checked too:

```bash
~/gryt/ops/internal/lan-proxy/check-ingress.mjs --certs
```

From a checkout on the Mac, to try a Caddyfile change before it merges:

```bash
ssh edition35 curl -s 127.0.0.1:20241/config | ops/internal/lan-proxy/check-ingress.mjs --ingress -
```

It exits 1 when a name in the Caddyfile isn't in the tunnel, or the tunnel sends it
somewhere else. With `--certs` it also connects to every name on `127.0.0.1:443`,
and fails if a certificate isn't valid or should have been renewed by now. A
`gryt.chat` name the tunnel sends to dev.lan that the Caddyfile doesn't have gets a
note. That one still works, through Cloudflare.

`gryt-lan-proxy-check.timer` runs it every hour, and posts to Discord when the
answer changes. So a route changed in the dashboard turns up within the hour.

To change a route here, change the Caddyfile in a pull request. dev.lan pulls it
within ten minutes, but Caddy doesn't reload on its own:

```bash
ssh edition35 docker exec gryt-lan-proxy caddy reload --config /etc/caddy/Caddyfile
```

## Setting it up

This needs the pull request merged and pulled on dev.lan, which takes up to ten
minutes: `ssh edition35 ls ~/gryt/ops/internal/lan-proxy` lists the files once it has.

1. **Make the Cloudflare token.** In the Cloudflare dashboard, API Tokens, Create
   Token, Custom token. Permissions `Zone / Zone / Read` and `Zone / DNS / Edit`.
   Zone resources: `Include / Specific zone / sivert.io`, and a second line for
   `gryt.chat`. No IP filter, since the house address changes.

2. **Put it on dev.lan.** This asks for the token without echoing it, writes `.env`
   readable only by you, and asks Cloudflare which zones it can see:

   ```bash
   ssh -t edition35 'read -rs -p "Cloudflare token: " t && echo && cd ~/gryt/ops/internal/lan-proxy && install -m 600 /dev/null .env && printf "CF_API_TOKEN=%s\n" "$t" > .env && printf "header = \"Authorization: Bearer %s\"\n" "$t" | curl -sS -K - https://api.cloudflare.com/client/v4/zones | python3 -c "import json,sys; print(sorted(z[\"name\"] for z in json.load(sys.stdin)[\"result\"]))"'
   ```

   It should print `['gryt.chat', 'sivert.io']`.

3. **Start the proxy.** Nothing points at it yet, so nobody notices:

   ```bash
   ssh edition35 'df -h / | tail -1 && cd ~/gryt && docker compose -f ops/internal/lan-proxy/compose.yml up -d --build --no-deps lan-proxy'
   ```

4. **Check it on dev.lan**, a minute later so both certificates are in:

   ```bash
   ssh edition35 '~/gryt/ops/internal/lan-proxy/check-ingress.mjs --certs'
   ```

   Every line should start with `ok`. If a certificate isn't there,
   `docker logs gryt-lan-proxy` says why. When Caddy rejects a token as malformed,
   that log line contains the token, so don't paste it anywhere.

5. **Test from the Mac, before touching DNS.** `--resolve` sends each name to dev.lan
   while DNS still points at Cloudflare, and curl checks the certificate as usual:

   ```bash
   for u in ws1.sivert.io/info nt.sivert.io/info pp.sivert.io/info beta.sivert.io/info demo.gryt.chat/info test.gryt.chat/info sfu.sivert.io/health beta-sfu.sivert.io/health test-sfu.gryt.chat/health auth.gryt.chat/realms/gryt/.well-known/openid-configuration id.gryt.chat/health reports.gryt.chat/healthz feedback.gryt.chat/_health monitoring.gryt.chat/api/health; do h=${u%%/*}; printf '%-22s ' $h; curl -sS -o /dev/null -w '%{http_code}\n' --resolve $h:443:192.168.50.147 https://$u; done
   ```

   Every line should say 200. Then a WebSocket, opened the way the apps open one. It
   should print 101:

   ```bash
   curl -sS --http1.1 -m 3 -o /dev/null -w '%{http_code}\n' --resolve test-sfu.gryt.chat:443:192.168.50.147 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://test-sfu.gryt.chat/client 2>/dev/null
   ```

6. **Add the AdGuard rewrites.** All fourteen names above, each to `192.168.50.147`,
   either in the web UI under Filters, DNS rewrites, or with this, which asks for the
   AdGuard login:

   ```bash
   printf 'AdGuard user: '; read -r u; printf 'Password: '; stty -echo; read -r p; stty echo; echo; for h in ws1.sivert.io nt.sivert.io pp.sivert.io sfu.sivert.io beta.sivert.io beta-sfu.sivert.io demo.gryt.chat test.gryt.chat test-sfu.gryt.chat auth.gryt.chat id.gryt.chat reports.gryt.chat feedback.gryt.chat monitoring.gryt.chat; do printf 'user = "%s:%s"\n' "$u" "$p" | curl -sS -K - -o /dev/null -w "$h %{http_code}\n" -H 'Content-Type: application/json' -d "{\"domain\":\"$h\",\"answer\":\"192.168.50.147\"}" http://192.168.50.182:3000/control/rewrite/add; done; unset p
   ```

   Every line should end in 200. An A record only is right: AdGuard then answers
   AAAA and HTTPS queries for these names with nothing, so nobody gets Cloudflare's
   IPv6 address or its HTTP/3 hint.

7. **Check it worked.** From the Mac, after flushing its DNS cache:

   ```bash
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder; dscacheutil -q host -a name ws1.sivert.io | grep address; dig +short AAAA ws1.sivert.io @192.168.50.182; curl -sS -o /dev/null -w '%{http_code} %{remote_ip}\n' https://ws1.sivert.io/info
   ```

   It should print `ip_address: 192.168.50.147`, no AAAA line, and `200 192.168.50.147`.
   Apps pick up the new address when they next connect, so restart them or wait for
   their DNS to expire, about five minutes.

8. **Turn on the hourly check.** The second command is optional and asks for a
   Discord webhook URL, which the check posts to when something changes:

   ```bash
   ssh -t edition35 'sudo ln -sfn ~/gryt/ops/internal/lan-proxy/check-ingress.mjs /usr/local/bin/gryt-lan-proxy-check && sudo cp ~/gryt/ops/internal/lan-proxy/systemd/gryt-lan-proxy-check.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now gryt-lan-proxy-check.timer && sudo systemctl start gryt-lan-proxy-check.service && journalctl -u gryt-lan-proxy-check -n 20 --no-pager'
   ssh -t edition35 'read -rs -p "Discord webhook URL: " u && echo && sudo install -m 600 /dev/null /etc/gryt-lan-proxy-check.env && echo "LAN_PROXY_WEBHOOK_URL=$u" | sudo tee /etc/gryt-lan-proxy-check.env >/dev/null'
   ```

## Rolling back

Delete the rewrites. That's all it takes: nothing else changed on the way in. In the
web UI, or with this:

```bash
printf 'AdGuard user: '; read -r u; printf 'Password: '; stty -echo; read -r p; stty echo; echo; for h in ws1.sivert.io nt.sivert.io pp.sivert.io sfu.sivert.io beta.sivert.io beta-sfu.sivert.io demo.gryt.chat test.gryt.chat test-sfu.gryt.chat auth.gryt.chat id.gryt.chat reports.gryt.chat feedback.gryt.chat monitoring.gryt.chat; do printf 'user = "%s:%s"\n' "$u" "$p" | curl -sS -K - -o /dev/null -w "$h %{http_code}\n" -H 'Content-Type: application/json' -d "{\"domain\":\"$h\",\"answer\":\"192.168.50.147\"}" http://192.168.50.182:3000/control/rewrite/delete; done; unset p
```

Stop the proxy only after that, once the apps have moved back, and turn the check off
with it:

```bash
ssh -t edition35 'sudo systemctl disable --now gryt-lan-proxy-check.timer; cd ~/gryt && docker compose -f ops/internal/lan-proxy/compose.yml stop lan-proxy'
```

## Second step: the community server

Written up, not built. `community.gryt.chat` and `community-sfu.gryt.chat` come from
the gryt-community VM under Astro, through the VM's own tunnel. Two things stand in
the way. Astro's isolation drops every new connection from the LAN to the VM, on
purpose, and the VM's server and SFU only listen on its loopback, for its own
cloudflared.

What fits around both:

1. On the VM, publish the server and SFU on its NAT address as well,
   `192.168.122.213:5020` and `:5025`, and let `192.168.122.1` reach those two
   ports in the guest's nftables.
2. On Astro, a plain TCP forwarder, socat or a small Caddy with no TLS, listening on
   two LAN ports and connecting to the VM. Astro connecting to the VM already works,
   since the isolation keeps that open for SSH, so its rules don't change.
3. Here, two more sites pointing at `http://unraid.lan:<those ports>`. `*.gryt.chat`
   covers both names, so the certificate and the token stay on dev.lan.
4. Two more AdGuard rewrites, to `192.168.50.147`.

`check-ingress.mjs` would need to know those two go through Astro, since the
community tunnel sends them to `localhost:5020` and `localhost:5025` on the VM.

A Caddy on the VM itself would be simpler, but it would need a token that can edit
`gryt.chat`'s DNS, on the machine most likely to get broken into.
