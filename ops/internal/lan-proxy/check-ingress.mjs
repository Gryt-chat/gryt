#!/usr/bin/env node
// Compares the Caddyfile's routes with the Cloudflare tunnel's, and with --certs the certificates it serves.
// README.md has how to run it, and the timer that does.

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));

// cloudflared's metrics server, which serves the ingress it's running with. Local to dev.lan.
const CLOUDFLARED_CONFIG = "http://127.0.0.1:20241/config";

// Every name in these zones is Gryt's. A route to this machine there that the Caddyfile lacks gets a note.
const GRYT_ZONES = ["gryt.chat"];

export function tokenize(text) {
  const out = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") line++;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    const start = line;
    let value = "";
    if (c === '"' || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) {
        if (c === '"' && text[i] === "\\") i++;
        if (text[i] === "\n") line++;
        value += text[i];
      }
      i++;
      out.push({ value, line: start, quoted: true });
      continue;
    }
    while (i < text.length && !/\s/.test(text[i])) value += text[i++];
    out.push({ value, line: start, quoted: false });
  }
  return out;
}

// Braces only open and close blocks as tokens of their own, so {args[0]} and {client_ip} are plain words.
function blocks(tokens) {
  const out = [];
  let head = [];
  let block = null;
  let depth = 0;
  for (const t of tokens) {
    const open = !t.quoted && t.value === "{";
    const close = !t.quoted && t.value === "}";
    if (depth === 0) {
      if (close) throw new Error(`line ${t.line}: a } that closes nothing`);
      if (!open) {
        head.push(t);
        continue;
      }
      block = { head: head.map((h) => h.value), line: head[0]?.line ?? t.line, directives: new Map() };
      head = [];
      depth = 1;
      continue;
    }
    if (open) depth++;
    else if (close) depth--;
    else if (depth === 1) {
      const line = block.directives.get(t.line) ?? [];
      line.push(t.value);
      block.directives.set(t.line, line);
    }
    if (depth === 0) out.push(block);
  }
  if (depth !== 0) throw new Error("a block is never closed");
  if (head.length) throw new Error(`line ${head[0].line}: "${head[0].value}" is outside any block`);
  return out;
}

/** Each site's host and the upstreams its block names, plus the wildcard sites that carry the certificates. */
export function parseCaddyfile(text) {
  const sites = [];
  const wildcards = [];
  for (const block of blocks(tokenize(text))) {
    if (block.head.length === 0 || /^\(.+\)$/.test(block.head[0])) continue;
    const upstreams = [];
    for (const words of block.directives.values()) {
      if (words[0] === "import" && words[1] === "upstream") upstreams.push(words[2]);
      if (words[0] === "reverse_proxy") upstreams.push(words[1]);
    }
    for (const address of block.head.join(" ").split(/[\s,]+/).filter(Boolean)) {
      const host = address.replace(/^https:\/\//, "").replace(/:443$/, "").toLowerCase();
      if (host.startsWith("*.")) wildcards.push(host);
      else sites.push({ host, upstreams, line: block.line });
    }
  }
  return { sites, wildcards };
}

/** The tunnel's rules, from cloudflared's /config or the Cloudflare API's configurations endpoint. */
export function ingressRules(json) {
  const rules = json?.config?.ingress ?? json?.result?.config?.ingress;
  if (!Array.isArray(rules)) throw new Error("there's no ingress list in that JSON");
  return rules.map((r) => ({ hostname: (r.hostname || "").toLowerCase(), path: r.path || "", service: r.service || "" }));
}

async function readIngress(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`it answered ${res.status}`);
    return ingressRules(await res.json());
  }
  return ingressRules(JSON.parse(readFileSync(source === "-" ? 0 : source, "utf8")));
}

const normal = (s) => String(s ?? "").trim().toLowerCase().replace(/\/+$/, "");

function machine(service) {
  try {
    return new URL(service).hostname;
  } catch {
    return null;
  }
}

// cloudflared's own matching: exact, or a *. rule matching any name that ends in the rest.
function matches(rule, host) {
  return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) : rule === host;
}

export function compare(sites, rules) {
  const ok = [];
  const problems = [];
  for (const site of sites) {
    const hits = rules.filter((r) => r.hostname && matches(r.hostname, site.host));
    const [rule] = hits;
    const [upstream] = site.upstreams;
    if (site.upstreams.length !== 1 || /^[/@*]/.test(upstream)) {
      problems.push(`${site.host}: the check needs exactly one upstream and no matcher, line ${site.line} of the Caddyfile`);
    } else if (!rule) {
      problems.push(`${site.host}: in the Caddyfile, but the tunnel has no route for it`);
    } else if (hits.some((r) => r.path)) {
      problems.push(`${site.host}: the tunnel routes it by path, so compare it by hand`);
    } else if (normal(rule.service) !== normal(upstream)) {
      problems.push(`${site.host}: the tunnel sends it to ${rule.service}, the Caddyfile to ${upstream}`);
    } else {
      ok.push(`${site.host} -> ${upstream}`);
    }
  }

  const proxied = new Set(sites.map((s) => s.host));
  const machines = new Set(sites.map((s) => machine(s.upstreams[0])).filter(Boolean));
  const notes = [];
  for (const rule of rules) {
    const name = rule.hostname;
    if (!name || proxied.has(name) || !machines.has(machine(rule.service))) continue;
    if (!GRYT_ZONES.some((zone) => name === zone || name.endsWith(`.${zone}`))) continue;
    notes.push(`${name} -> ${rule.service} is in the tunnel and not in the Caddyfile, so it goes through Cloudflare at home too`);
  }
  return { ok, problems, notes };
}

function served(address, host) {
  const [ip, port = "443"] = address.split(/:(?=\d+$)/);
  return new Promise((resolve) => {
    const socket = tls.connect({ host: ip, port: Number(port), servername: host, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve({ from: new Date(cert.valid_from), to: new Date(cert.valid_to) });
    });
    socket.on("timeout", () => socket.destroy(new Error("timed out")));
    socket.on("error", (err) => resolve({ error: err.message }));
  });
}

// Caddy renews with a third of the lifetime left, so under a sixth means renewal has been failing a while.
export async function checkCertificates(sites, address, now = Date.now()) {
  const ok = [];
  const problems = [];
  for (const { host } of sites) {
    const cert = await served(address, host);
    if (cert.error) {
      problems.push(`${host}: no valid certificate from ${address} (${cert.error})`);
      continue;
    }
    const days = Math.floor((cert.to - now) / 86_400_000);
    if (cert.to - now < (cert.to - cert.from) / 6) problems.push(`${host}: the certificate runs out in ${days} days and hasn't been renewed`);
    else ok.push(`${host}: certificate good for ${days} more days`);
  }
  return { ok, problems, notes: [] };
}

/** Posts to Discord when the problems change, so a drift is one message and so is its fix. */
async function notify(problems) {
  const dir = process.env.STATE_DIRECTORY || "/var/lib/gryt-lan-proxy-check";
  const file = join(dir, "last");
  const now = problems.join("\n");
  let before = null;
  try {
    before = readFileSync(file, "utf8");
  } catch {}
  const save = () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, now);
  };
  if (now === before || (before === null && !now)) return save();

  const url = process.env.LAN_PROXY_WEBHOOK_URL;
  if (!url) {
    console.log("no LAN_PROXY_WEBHOOK_URL, so nothing was posted");
    return save();
  }
  const text = now
    ? `The LAN proxy on dev.lan needs a look:\n${problems.map((p) => `- ${p}`).join("\n")}`
    : "The LAN proxy on dev.lan is fine again.";
  let status = "nothing";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
  } catch {}
  if (!(status >= 200 && status < 300)) return console.log(`the webhook answered ${status}, so it's tried again next run`);
  save();
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      ingress: { type: "string", default: CLOUDFLARED_CONFIG },
      caddyfile: { type: "string", default: join(HERE, "Caddyfile") },
      certs: { type: "boolean", default: false },
      proxy: { type: "string", default: "127.0.0.1" },
      notify: { type: "boolean", default: false },
    },
  });
  const { sites } = parseCaddyfile(readFileSync(values.caddyfile, "utf8"));
  const result = { ok: [], problems: [], notes: [] };
  const add = (part) => Object.keys(result).forEach((k) => result[k].push(...part[k]));

  try {
    add(compare(sites, await readIngress(values.ingress)));
  } catch (err) {
    result.problems.push(`couldn't read the tunnel's routes from ${values.ingress}: ${err.message}`);
  }
  if (values.certs) add(await checkCertificates(sites, values.proxy));

  for (const line of result.ok) console.log(`ok       ${line}`);
  for (const line of result.notes) console.log(`note     ${line}`);
  for (const line of result.problems) console.log(`PROBLEM  ${line}`);
  if (values.notify) await notify(result.problems);
  process.exitCode = result.problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
