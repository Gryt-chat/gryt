# ops/edge

The page gryt.chat serves when the origin doesn't answer.

Everything a browser gets from Gryt is served from home through a Cloudflare
tunnel. When home is down, Cloudflare puts up its own page — "this service is
offline", or error 1033 when the connectors have nothing behind them. It doesn't
say Gryt anywhere and it doesn't mention the status page.

This is a Worker in front of those hostnames. It passes every response through,
and swaps the body when the origin didn't answer.

## What counts as "didn't answer"

502, 503, 504, the 52x family and 530, plus a `fetch` that throws. 530 is what a
tunnel with nothing behind it returns, so it's the one that matters most.

A 500 the origin chose for itself passes through. Hiding a real bug behind an
apology is how it goes unnoticed for a week.

## Why it answers 503

Every check on [status.gryt.chat](https://status.gryt.chat) asserts on the
response body, not just the code. A friendly page returning 200 would read as an
outage the monitoring calls fine — and search engines would index the apology.

So it's 503, with `Retry-After` and `Cache-Control: no-store`.

## Why the page fetches nothing

The machine that serves the fonts, the stylesheet and the logo is the one that's
down. So the CSS is inline, the owl is an inline SVG, and the type is a system
stack. `check-offline-page.mjs` fails if anything in it points at a URL other
than the status page.

## What it isn't in front of

`www.gryt.chat` is a redirect to the bare hostname. Redirect rules run before Workers,
so a route there would never serve anything — whoever typed `www` lands on `gryt.chat`
and gets the page from there if it's down.


`ws1.sivert.io` and `sfu.sivert.io` are the API and the signalling socket. The
client already handles a connection it can't make, and an HTML body there would
only confuse it.

`status.gryt.chat` is what the page links to. It runs on the Gigahost VPS on its
own tunnel, which is the whole reason it's still up when the rest isn't.

## Deploying

```bash
cd ops/edge && npx wrangler deploy
```

That needs `CLOUDFLARE_API_TOKEN` with **Workers Scripts: Edit** and **Workers
Routes: Edit** on the gryt.chat zone. `.github/workflows/deploy-offline-page.yml`
does the same thing on dispatch once that's an org secret.

The routes are in `wrangler.toml`, so adding a hostname is a commit here rather
than a dashboard click.

## Before the first deploy

Workers Free is 100,000 requests a day for the whole account, and this runs on
every request to five hostnames. Check the account's usage, and check what the
Worker does when it runs out — the choice is between falling through to the
origin and returning an error, and only the first is safe here.

## Testing it

`wrangler dev` proxies to the real origin, which is up, so the interesting path
doesn't happen on its own. Point it at something dead instead:

```bash
cd ops/edge && npx wrangler dev --local
curl -sI http://localhost:8787/ | head -3
```

The check script covers the rest, and it's in `Repo checks`:

```bash
node .github/scripts/check-offline-page.mjs
```
