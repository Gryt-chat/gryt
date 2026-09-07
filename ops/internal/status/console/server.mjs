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

const CONFIG_DIR = process.env.CONSOLE_CONFIG_DIR || "/config";
const FILE = join(CONFIG_DIR, "announcements.yaml");
const PORT = Number(process.env.PORT || 3002);
const PASSWORD_HASH = process.env.CONSOLE_PASSWORD_HASH || "";

const SESSION_HOURS = 12;
const MAX_MESSAGE = 240;
const TYPES = ["outage", "warning", "information", "operational"];

/* ── Password ─────────────────────────────────────────────────────────── */

/** `scrypt$<salt base64>$<hash base64>`, as printed by `--hash`. */
function verifyPassword(password) {
  const parts = PASSWORD_HASH.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

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

function page(session, error) {
  const live = session ? readAnnouncements().filter((a) => !a.archived) : [];
  const current = live.length
    ? `<p class="live"><strong>Live:</strong> ${escapeHtml(live[live.length - 1].message)}</p>`
    : `<p class="quiet">Nothing announced. The banner is silent.</p>`;

  const form = session
    ? `${current}
      <form method="post">
        <input type="hidden" name="do" value="announce">
        <textarea name="message" maxlength="${MAX_MESSAGE}" rows="3" required
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
      <form method="post">
        <input type="hidden" name="do" value="resolve">
        <button type="submit" class="secondary">Resolve — post the all-clear and stop the banner</button>
      </form>`
    : `<form method="post">
        <input type="hidden" name="do" value="login">
        <input type="password" name="password" placeholder="Password" autofocus required>
        <button type="submit">Sign in</button>
      </form>`;

  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gryt status console</title>
<style>
  :root { color-scheme: dark }
  body { font: 15px/1.5 system-ui, sans-serif; background:#0f1115; color:#e6e8ec;
         margin:0; display:grid; place-items:center; min-height:100vh; padding:20px }
  main { width:100%; max-width:520px }
  h1 { font-size:18px; margin:0 0 4px }
  .sub { color:#8b90a0; margin:0 0 20px; font-size:13px }
  form { display:grid; gap:10px; margin:0 0 14px }
  textarea, input, select, button { font:inherit; padding:10px 12px; border-radius:8px;
    border:1px solid #2a2f3a; background:#171a21; color:inherit; width:100%; box-sizing:border-box }
  .row { display:flex; gap:10px }
  .row select { flex:1 } .row button { flex:0 0 auto }
  button { background:#4b5bdc; border-color:#4b5bdc; cursor:pointer; font-weight:600 }
  .secondary { background:#171a21; border-color:#2a2f3a; font-weight:500 }
  .error { color:#ff8080; font-size:13px; margin:0 0 12px }
  .live { background:#2a1d1d; border:1px solid #5a2c2c; padding:10px 12px; border-radius:8px }
  .quiet { color:#8b90a0; font-size:13px }
</style>
<main>
  <h1>Status console</h1>
  <p class="sub">Posts to status.gryt.chat and to the banner in every signed-in client.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  ${form}
</main>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
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
  const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?";
  const session = validSession(cookieFrom(req));

  if (req.method === "GET" && path.endsWith("/health")) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (req.method === "GET") return send(res, 200, page(session));

  if (req.method !== "POST") return send(res, 405, page(session, "Not allowed"));

  const form = await body(req);
  const action = form.get("do");

  if (action === "login") {
    if (throttled(ip)) return send(res, 429, page(false, "Too many attempts. Wait 15 minutes."));
    if (!PASSWORD_HASH) return send(res, 500, page(false, "CONSOLE_PASSWORD_HASH is not set."));

    if (!verifyPassword(form.get("password") || "")) {
      recordFailure(ip);
      return send(res, 401, page(false, "Wrong password."));
    }

    attempts.delete(ip);
    const cookie = `session=${issueSession()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
    return send(res, 200, page(true), cookie);
  }

  if (!session) return send(res, 401, page(false, "Sign in first."));

  if (action === "announce") {
    const message = (form.get("message") || "").trim().slice(0, MAX_MESSAGE);
    if (!message) return send(res, 400, page(true, "Say what is wrong."));

    const type = TYPES.includes(form.get("type")) ? form.get("type") : "outage";

    /* Everything already up is archived rather than dropped, so the status
       page keeps the history of an incident that got updated. */
    const list = readAnnouncements().map((a) => ({ ...a, archived: true }));
    list.push({ timestamp: new Date().toISOString(), type, message });
    writeAnnouncements(list);

    return send(res, 200, page(true));
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

    return send(res, 200, page(true));
  }

  return send(res, 404, page(session, "No such thing."));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`status console on :${PORT}, writing ${FILE}`);
  if (!PASSWORD_HASH) console.warn("CONSOLE_PASSWORD_HASH is not set — nobody can sign in.");
});
