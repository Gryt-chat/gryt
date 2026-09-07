#!/usr/bin/env node
/**
 * Posts announcements to the status page (GRYT-983).
 *
 * Writes announcements.yaml into the directory Gatus already reads. Gatus
 * merges every *.yaml in that directory and appends arrays, so this file adds
 * to config.yaml without touching it, and Gatus reloads on its own.
 *
 * Runs on the VPS next to Gatus, not at home with the site: everything the
 * status page describes is served from home through one Cloudflare tunnel, so a
 * console there is unreachable at the moment it is needed.
 *
 * Password only, deliberately. The obvious alternative is Keycloak, which runs
 * on the machine most likely to be down when somebody needs to post here.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

/* @gryt/ui's published stylesheet, fetched at image build time. It carries the
   token system this page is styled from, so the console looks like Gryt rather
   than like something invented beside it. */
const STYLESHEET = (() => {
  try {
    return readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();

const CONFIG_DIR = process.env.CONSOLE_CONFIG_DIR || "/config";
const FILE = join(CONFIG_DIR, "announcements.yaml");
const PORT = Number(process.env.PORT || 3002);
const PASSWORD_HASH = process.env.CONSOLE_PASSWORD_HASH || "";

const SESSION_HOURS = 12;
const MAX_MESSAGE = 240;
const TYPES = ["outage", "warning", "information", "operational"];

/* ── Password ─────────────────────────────────────────────────────────── */

/**
 * `scrypt:<salt base64>:<hash base64>`, as printed by hash-password.mjs.
 *
 * `$` is still accepted because the first version of this used it, but never
 * emitted: Docker Compose interpolates `$` in a .env value, so a $-delimited
 * hash reaches the container with the salt and hash substituted away as
 * undefined variables, and every password is wrong for a reason nothing says
 * out loud.
 */
function parseHash() {
  const parts = PASSWORD_HASH.includes(":")
    ? PASSWORD_HASH.split(":")
    : PASSWORD_HASH.split("$");
  return parts.length === 3 && parts[0] === "scrypt" ? parts : null;
}

function verifyPassword(password) {
  const parts = parseHash();
  if (!parts) return false;

  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = scryptSync(password, salt, expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* Derived from the password hash so there is one secret to keep, and rotating
   the password invalidates every session for free. */
const SESSION_KEY = createHmac("sha256", PASSWORD_HASH).update("session").digest();

function issueSession() {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const sig = createHmac("sha256", SESSION_KEY).update(String(expires)).digest("base64url");
  return `${expires}.${sig}`;
}

function validSession(cookie) {
  const [expires, sig] = String(cookie || "").split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;

  const want = createHmac("sha256", SESSION_KEY).update(expires).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* One machine posts here. A fixed lockout after a handful of tries costs
   nothing and takes offline guessing off the table. */
const attempts = new Map();
function throttled(ip) {
  const a = attempts.get(ip);
  return a && a.count >= 5 && Date.now() - a.at < 15 * 60_000;
}
function recordFailure(ip) {
  const a = attempts.get(ip) ?? { count: 0, at: 0 };
  attempts.set(ip, { count: a.count + 1, at: Date.now() });
}

/* ── The file ─────────────────────────────────────────────────────────── */

function readAnnouncements() {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")).announcements ?? [];
  } catch {
    return [];
  }
}

/**
 * Written as JSON, which is valid YAML.
 *
 * Building YAML by hand would mean quoting and escaping a message somebody
 * typed, and getting that wrong writes a config that stops Gatus. JSON.stringify
 * already handles it.
 */
function writeAnnouncements(list) {
  const body = JSON.stringify({ announcements: list }, null, 2) + "\n";

  /* Kept so a bad write can be undone by hand without reconstructing it. */
  if (existsSync(FILE)) copyFileSync(FILE, `${FILE}.bak`);

  /* Written then renamed, because Gatus watches this directory and would
     otherwise reload a half-written file. */
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, FILE);
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

const NAV = [{ href: "", label: "Announcements", active: true }];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/**
 * The page, under whatever prefix the tunnel routes on.
 *
 * `base` is the request's own path, so every URL this emits — the stylesheet,
 * the nav — resolves correctly at /console and at /. GRYT-987 was this bug in
 * the form actions; the same trap catches every other link.
 */
function layout(base, { session, error, content }) {
  const nav = session
    ? NAV.map(
        (n) =>
          `<a class="nav-item${n.active ? " is-active" : ""}" href="${base}${n.href}">${n.label}</a>`,
      ).join("")
    : "";

  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Status console — Gryt</title>
<link rel="stylesheet" href="${base}styles.css">
<style>
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--gryt-neutral-1);
    color: var(--gryt-neutral-12);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.55;
  }
  .shell { max-width: 640px; margin: 0 auto; padding: 40px 20px 64px }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px }
  .mark {
    width: 30px; height: 30px; border-radius: var(--gryt-radius-full);
    background: var(--gryt-accent-9); flex: 0 0 auto;
  }
  h1 { font-size: 19px; font-weight: 650; margin: 0; letter-spacing: -0.01em }
  .sub { color: var(--gryt-neutral-11); font-size: 13.5px; margin: 0 0 26px 42px }
  nav { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--gryt-neutral-6) }
  .nav-item {
    padding: 8px 13px; font-size: 13.5px; text-decoration: none; font-weight: 500;
    color: var(--gryt-neutral-11); border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .nav-item:hover { color: var(--gryt-neutral-12) }
  .nav-item.is-active { color: var(--gryt-accent-11); border-bottom-color: var(--gryt-accent-9) }
  .panel {
    background: var(--gryt-neutral-2); border: 1px solid var(--gryt-neutral-6);
    border-radius: var(--gryt-radius-lg); padding: 20px;
  }
  .panel + .panel { margin-top: 14px }
  h2 { font-size: 14px; font-weight: 600; margin: 0 0 3px }
  .hint { color: var(--gryt-neutral-11); font-size: 13px; margin: 0 0 16px }
  form { display: grid; gap: 11px; margin: 0 }
  textarea, input, select {
    font: inherit; width: 100%; box-sizing: border-box; padding: 10px 12px;
    background: var(--gryt-neutral-1); color: var(--gryt-neutral-12);
    border: 1px solid var(--gryt-neutral-7); border-radius: var(--gryt-radius-input);
  }
  textarea { resize: vertical; min-height: 78px }
  textarea:focus, input:focus, select:focus {
    outline: none; border-color: var(--gryt-accent-8);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--gryt-accent-9) 22%, transparent);
  }
  .row { display: flex; gap: 10px }
  .row select { flex: 1 }
  .row button { flex: 0 0 auto }
  button {
    font: inherit; font-weight: 600; padding: 10px 18px; cursor: pointer;
    border-radius: var(--gryt-radius-input); border: 1px solid var(--gryt-accent-9);
    background: var(--gryt-accent-9); color: var(--gryt-accent-contrast, #fff);
  }
  button:hover { background: var(--gryt-accent-10); border-color: var(--gryt-accent-10) }
  button.secondary {
    background: transparent; color: var(--gryt-neutral-12);
    border-color: var(--gryt-neutral-7); font-weight: 500; width: 100%;
  }
  button.secondary:hover { background: var(--gryt-neutral-3) }
  .banner { border-radius: var(--gryt-radius-md); padding: 11px 13px; font-size: 13.5px; margin: 0 0 16px }
  .banner.live {
    background: color-mix(in oklab, var(--gryt-danger-9) 11%, transparent);
    border: 1px solid color-mix(in oklab, var(--gryt-danger-9) 26%, transparent);
  }
  .banner.quiet {
    background: var(--gryt-neutral-3); border: 1px solid var(--gryt-neutral-6);
    color: var(--gryt-neutral-11);
  }
  .banner.error {
    background: color-mix(in oklab, var(--gryt-danger-9) 13%, transparent);
    border: 1px solid color-mix(in oklab, var(--gryt-danger-9) 30%, transparent);
    color: var(--gryt-danger-11);
  }
  .stamp { color: var(--gryt-neutral-11); font-size: 12px; display: block; margin-top: 3px }
</style>
<div class="shell">
  <header><div class="mark"></div><h1>Status console</h1></header>
  <p class="sub">Posts to status.gryt.chat and to every signed-in Gryt client.</p>
  ${nav ? `<nav>${nav}</nav>` : ""}
  ${error ? `<div class="banner error">${escapeHtml(error)}</div>` : ""}
  ${content}
</div>`;
}

/** UTC and spelled out, because the server's clock is not the reader's. */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

function announcementsPanel() {
  const live = readAnnouncements().filter((a) => !a.archived && a.type !== "operational");
  const current = live[live.length - 1];

  const state = current
    ? `<div class="banner live"><strong>Live now.</strong> ${escapeHtml(current.message)}
         <span class="stamp">Posted ${escapeHtml(when(current.timestamp))}</span></div>`
    : `<div class="banner quiet">Nothing announced. No banner is showing in the client.</div>`;

  return `<div class="panel">
    <h2>Announcement</h2>
    <p class="hint">Everyone signed in sees this until you resolve it.</p>
    ${state}
    <form method="post">
      <input type="hidden" name="do" value="announce">
      <textarea name="message" maxlength="${MAX_MESSAGE}" required
        placeholder="An issue has appeared and we are investigating it."></textarea>
      <div class="row">
        <select name="type">
          <option value="outage">Outage</option>
          <option value="warning">Warning</option>
          <option value="information">Information</option>
        </select>
        <button type="submit">Post</button>
      </div>
    </form>
  </div>
  ${current ? `<div class="panel">
    <h2>Resolve</h2>
    <p class="hint">Marks it over on the status page and stops the banner.</p>
    <form method="post">
      <input type="hidden" name="do" value="resolve">
      <button type="submit" class="secondary">Post the all-clear</button>
    </form>
  </div>` : ""}`;
}

function loginPanel() {
  return `<div class="panel">
    <h2>Sign in</h2>
    <p class="hint">The password is in Bitwarden.</p>
    <form method="post">
      <input type="hidden" name="do" value="login">
      <input type="password" name="password" placeholder="Password" autofocus required>
      <div class="row"><button type="submit">Sign in</button></div>
    </form>
  </div>`;
}

function page(base, session, error) {
  return layout(base, {
    session,
    error,
    content: session ? announcementsPanel() : loginPanel(),
  });
}

function body(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 8192) req.destroy();
    });
    req.on("end", () => resolve(new URLSearchParams(data)));
  });
}

function send(res, status, html, cookie) {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(html);
}

const cookieFrom = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)),
  ).session;

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;

  /* Every URL the page emits hangs off the path it was served at, so the page
     works at /console and at / without knowing which. */
  const base = path.endsWith("/") ? path : `${path}/`;
  const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?";
  const session = validSession(cookieFrom(req));

  if (req.method === "GET" && path.endsWith("/styles.css")) {
    res.writeHead(200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=3600",
    });
    return res.end(STYLESHEET);
  }

  if (req.method === "GET" && path.endsWith("/health")) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (req.method === "GET") return send(res, 200, page(base, session));

  if (req.method !== "POST") return send(res, 405, page(base, session, "Not allowed"));

  const form = await body(req);
  const action = form.get("do");

  if (action === "login") {
    if (throttled(ip)) return send(res, 429, page(base, false, "Too many attempts. Wait 15 minutes."));
    if (!PASSWORD_HASH) return send(res, 500, page(base, false, "CONSOLE_PASSWORD_HASH is not set."));

    /* Says the hash is broken rather than the password is wrong. The two look
       identical from here and only one of them is the person's fault. */
    if (!parseHash()) {
      return send(
        res,
        500,
        page(base, false, `CONSOLE_PASSWORD_HASH is malformed (${PASSWORD_HASH.length} chars). Re-run hash-password.mjs.`),
      );
    }

    if (!verifyPassword(form.get("password") || "")) {
      recordFailure(ip);
      return send(res, 401, page(base, false, "Wrong password."));
    }

    attempts.delete(ip);
    const cookie = `session=${issueSession()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
    return send(res, 200, page(base, true), cookie);
  }

  if (!session) return send(res, 401, page(base, false, "Sign in first."));

  if (action === "announce") {
    const message = (form.get("message") || "").trim().slice(0, MAX_MESSAGE);
    if (!message) return send(res, 400, page(base, true, "Say what is wrong."));

    const type = TYPES.includes(form.get("type")) ? form.get("type") : "outage";

    /* Everything already up is archived rather than dropped, so the status
       page keeps the history of an incident that got updated. */
    const list = readAnnouncements().map((a) => ({ ...a, archived: true }));
    list.push({ timestamp: new Date().toISOString(), type, message });
    writeAnnouncements(list);

    return send(res, 200, page(base, true));
  }

  if (action === "resolve") {
    /* `operational` is Gatus's all-clear, and the client skips it — so this
       closes the incident on the page and stops the banner in one write. */
    const list = readAnnouncements().map((a) => ({ ...a, archived: true }));
    list.push({
      timestamp: new Date().toISOString(),
      type: "operational",
      message: "Resolved. Everything is back to normal.",
    });
    writeAnnouncements(list);

    return send(res, 200, page(base, true));
  }

  return send(res, 404, page(base, session, "No such thing."));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`status console on :${PORT}, writing ${FILE}`);
  if (!PASSWORD_HASH) console.warn("CONSOLE_PASSWORD_HASH is not set — nobody can sign in.");
  else if (!parseHash())
    console.warn(
      `CONSOLE_PASSWORD_HASH is malformed (${PASSWORD_HASH.length} chars) — nobody can sign in. ` +
        "If it contains $, Docker Compose ate it; re-run hash-password.mjs for a colon-delimited one.",
    );
});
