#!/usr/bin/env node
/* eslint-env node */

/** Every image a self-hoster's `docker compose pull` would fetch, checked
 *  anonymously against its registry. GRYT-1439. */

/* Compose files self-hosters curl, plus any other one under ops/deploy/.
   ops/internal is skipped — its images (gatus, postgres, fider…) differ. */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

const CLI_SHARED_GO_URL =
  process.env.GRYT_CLI_SHARED_GO_URL ??
  "https://raw.githubusercontent.com/Gryt-chat/cli/main/internal/config/shared.go";

/* The gryt CLI's default channel is stable, which ImageTag() resolves to
   "latest". Only the sfu image uses that call; the other two are literal. */
const CLI_DEFAULT_TAG = "latest";

/** Runs a command, returning stdout, or throws with stderr attached. */
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

/** Every compose file under ops/deploy/, via git so nothing is guessed. */
function listComposeCandidates() {
  const out = run("git", ["-C", ROOT, "ls-files", "ops/deploy"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.ya?ml$/.test(l));
}

/** True when the file parses as a compose file (has a top-level `services`). */
function isComposeFile(path) {
  const json = run("yq", ["-o=json", ".services", `${ROOT}${path}`]).trim();
  return json !== "null" && json !== "{}";
}

/** [{ image, key, file }] for every service with an `image:` in one compose file. */
function imagesInComposeFile(path) {
  const json = run("yq", [
    "-o=json",
    '[.services | to_entries[] | select(.value | has("image")) | {"key": .key, "image": .value.image}]',
    `${ROOT}${path}`,
  ]);
  return JSON.parse(json).map((e) => ({ ...e, file: path }));
}

/** Fetches the CLI's shared compose template and pulls out its `image:` lines. */
async function imagesInCliSharedGo() {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(CLI_SHARED_GO_URL);
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const source = await res.text();
      return extractCliImages(source);
    } catch (e) {
      last = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error(`could not fetch ${CLI_SHARED_GO_URL}: ${last}`);
}

/* Tight on purpose: only the two shapes this file actually uses. A third
   shape should fail loudly rather than be silently skipped. */
function extractCliImages(source) {
  const images = [];
  const literal = /^\s*image:\s*([\w./-]+:[\w.-]+)\s*$/gm;
  const interpolated =
    /^\s*image:\s*([\w./-]+):`\s*\+\s*s\.Preferences\(\)\.ImageTag\(\)\s*\+\s*`\s*$/gm;

  for (const m of source.matchAll(literal)) {
    images.push({ image: m[1], key: null, file: "packages/cli/internal/config/shared.go" });
  }
  for (const m of source.matchAll(interpolated)) {
    images.push({
      image: `${m[1]}:${CLI_DEFAULT_TAG}`,
      key: null,
      file: "packages/cli/internal/config/shared.go",
    });
  }

  if (images.length === 0) {
    throw new Error(
      "shared.go has no image: line matching either known shape — the regex needs updating, not skipping",
    );
  }
  return images;
}

/** `${VAR:-default}` resolves to its default; `${VAR}` with none fails loudly. */
function resolveImageRef(image) {
  let unresolved = null;
  const resolved = image.replace(/\$\{([A-Z0-9_]+)(:-([^}]*))?\}/g, (_, name, hasDefault, def) => {
    if (hasDefault === undefined) {
      unresolved = name;
      return `\${${name}}`;
    }
    return def;
  });
  if (unresolved) {
    throw new Error(`\${${unresolved}} has no default and can't be resolved`);
  }
  return resolved;
}

async function collectImages() {
  const composeFiles = [
    "ops/deploy/compose/prod.yml",
    "ops/deploy/compose/beta.yml",
    "ops/deploy/host/compose.yml",
    ...listComposeCandidates(),
  ];
  const uniqueFiles = [...new Set(composeFiles)];

  const entries = [];
  for (const file of uniqueFiles) {
    if (!isComposeFile(file)) continue;
    entries.push(...imagesInComposeFile(file));
  }
  entries.push(...(await imagesInCliSharedGo()));

  /* Dedupe by resolved ref, keeping every source that named it — a self-hoster
     hits whichever source they used, so all of them need reporting on failure. */
  const byRef = new Map();
  for (const { image, file } of entries) {
    const ref = resolveImageRef(image);
    if (!byRef.has(ref)) byRef.set(ref, { ref, sources: [] });
    const entry = byRef.get(ref);
    if (!entry.sources.includes(file)) entry.sources.push(file);
  }
  return [...byRef.values()];
}

const REQUIRED_PLATFORMS = ["linux/amd64", "linux/arm64"];

/** Anonymous manifest inspect, retried 3x with backoff so one hiccup isn't fatal. */
function inspectPlatforms(ref) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = run("docker", ["buildx", "imagetools", "inspect", ref, "--raw"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      return platformsFromManifest(JSON.parse(raw));
    } catch (e) {
      lastError = e.stderr?.toString().trim() || e.message;
      if (attempt < 3) sleepSync(attempt * 3000);
    }
  }
  throw new Error(lastError);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Both a manifest list and a single-platform manifest come out normalized. */
function platformsFromManifest(manifest) {
  const list = manifest.manifests ?? [manifest];
  return list
    .map((m) => m.platform)
    .filter((p) => p && p.os !== "unknown" && p.architecture !== "unknown")
    .map((p) => `${p.os}/${p.architecture}`);
}

async function main() {
  const images = await collectImages();
  const results = [];

  for (const { ref, sources } of images) {
    let platforms = [];
    let error = null;
    try {
      platforms = inspectPlatforms(ref);
    } catch (e) {
      error = e.message;
    }

    const missing = error ? REQUIRED_PLATFORMS : REQUIRED_PLATFORMS.filter((p) => !platforms.includes(p));
    const ok = !error && missing.length === 0;
    results.push({ ref, sources, platforms, ok, error, missing });
  }

  writeSummary(results);
  const resultsPath = process.env.GRYT_IMAGE_CHECK_RESULTS ?? `${ROOT}.work/compose-image-results.json`;
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const line = r.ok
      ? `ok    ${r.ref}`
      : `FAIL  ${r.ref}  (${r.error ?? `missing ${r.missing.join(", ")}`})`;
    console.log(line);
  }

  if (failed.length > 0) {
    console.error(
      `\n${failed.length} image(s) failed the anonymous pull check: ${failed.map((r) => r.ref).join(", ")}`,
    );
    process.exitCode = 1;
  }
}

function writeSummary(results) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const rows = results
    .map(
      (r) =>
        `| \`${r.ref}\` | ${r.sources.join("<br>")} | ${r.ok ? r.platforms.join(", ") : "—"} | ${
          r.ok ? "✅ ok" : `❌ ${r.error ?? `missing ${r.missing.join(", ")}`}`
        } |`,
    )
    .join("\n");
  const table = `## Compose images\n\n| Image | Source | Platforms | Result |\n| --- | --- | --- | --- |\n${rows}\n`;

  if (summaryPath) {
    writeFileSync(summaryPath, table, { flag: "a" });
  } else {
    console.log(table);
  }
}

await main();
