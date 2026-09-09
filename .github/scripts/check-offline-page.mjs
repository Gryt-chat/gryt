/* eslint-env node */

/**
 * The page the edge serves when the origin is down, and the rules that make it
 * worth having.
 */

/* It is only ever seen while the machine that serves the fonts, the stylesheet
   and the logo is unreachable, so anything it fetches is a broken box on it. */

/* And it answers 503. Every status.gryt.chat check asserts on the body, so a
   friendly page with a 200 would read as an outage the monitoring calls fine. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isOriginDown, offlineResponse } from "../../ops/edge/src/offline.js";

const edge = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ops", "edge");
const html = readFileSync(join(edge, "src", "offline.html"), "utf8");
const wrangler = readFileSync(join(edge, "wrangler.toml"), "utf8");

/* ── the page fetches nothing ─────────────────────────────────────────────── */

// The status page is the one address it may name, because it is somewhere else.
const ALLOWED = "https://status.gryt.chat";

const urls = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)]
  .map((m) => m[1])
  .filter((url) => url !== "" && url !== ALLOWED);

assert.deepEqual(urls, [], "the page loads something over the network");

assert.equal(html.includes("@font-face"), false, "the page pulls a webfont");
assert.equal(/url\(\s*["']?(?:https?:)?\/\//.test(html), false, "a stylesheet fetches something");
assert.ok(html.includes(ALLOWED), "the page never links to the status page");
assert.ok(html.includes('name="robots" content="noindex"'), "the apology is indexable");

/* ── it stands in only for an origin that did not answer ──────────────────── */

for (const status of [502, 503, 504, 521, 522, 523, 525, 530]) {
  assert.ok(isOriginDown(status), `${status} is the origin being unreachable`);
}

// A 500 the origin chose is its own to explain, and hiding it behind an apology
// is how a real bug goes unnoticed. 429 and 404 are answers, not silence.
for (const status of [200, 301, 404, 429, 500, 501]) {
  assert.equal(isOriginDown(status), false, `${status} is not the origin being down`);
}

/* ── and says so with a code monitoring can read ──────────────────────────── */

const response = offlineResponse(html);

assert.equal(response.status, 503, "the page answers with a success-shaped code");
assert.equal(response.headers.get("cache-control"), "no-store", "the outage gets cached");
assert.ok(response.headers.get("retry-after"), "nothing tells a client when to come back");

/* ── the routes leave out what must not be behind it ──────────────────────── */

// The patterns, not the whole file: the comment above them names status.gryt.chat
// to say why it is absent, and a substring search reads that as a route.
const routed = [...wrangler.matchAll(/pattern\s*=\s*"([^/"]+)/g)].map((m) => m[1]);

for (const host of ["status.gryt.chat", "ws1.sivert.io", "sfu.sivert.io"]) {
  assert.equal(routed.includes(host), false, `${host} is routed through the offline page`);
}

assert.ok(routed.length >= 5, `only ${routed.length} hostnames are routed`);

console.log(`offline page: self-contained, answers 503, ${routed.length} hostnames routed`);
