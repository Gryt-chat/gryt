// Should <image>:latest-beta move to a stable release? Prints the digest to point it at, or
// nothing when latest-beta is already that new. All four release workflows call this. GRYT-1236.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ATTEMPTS = 3;

const MANIFESTS = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** A full version's parts, or null for anything else: `1.10`, `latest`, `buildcache`. */
export function parseVersion(text) {
  const match = typeof text === "string" ? VERSION.exec(text) : null;
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split(".") : [] };
}

/** Semver precedence, so 1.10.14-beta.3 < 1.10.14 < 1.11.0-beta.2. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`);

  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return Math.sign(x.core[i] - y.core[i]);
  }
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);

  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    const [pNumber, qNumber] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pNumber && qNumber) {
      if (Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q));
    } else if (pNumber !== qNumber) {
      return pNumber ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/** Whether latest-beta, carrying version `current`, should move to `release`. */
export function decide(release, current) {
  const parsed = parseVersion(release);
  if (!parsed || parsed.pre.length) throw new Error(`${release} is not a stable version`);

  if (current == null) {
    return { move: true, why: `latest-beta has no version to compare, so it moves to ${release}.` };
  }
  if (!parseVersion(current)) {
    return { move: true, why: `latest-beta's version "${current}" can't be read, so it moves to ${release}.` };
  }

  const order = compareVersions(current, release);
  if (order > 0) return { move: false, why: `latest-beta is ${current}, newer than ${release}, so it stays.` };
  if (order === 0) return { move: false, why: `latest-beta is already ${release}.` };
  return { move: true, why: `latest-beta is ${current}, older than ${release}, so it moves to ${release}.` };
}

/** The highest version tag on `digest`, or null. Newest first, so a current latest-beta costs a request or two. */
export async function versionOf(digest, tags, digestOf) {
  const versions = tags.filter((tag) => parseVersion(tag)).sort((a, b) => compareVersions(b, a));
  for (const tag of versions) {
    if ((await digestOf(tag)) === digest) return tag;
  }
  return null;
}

/** Reads tags and digests anonymously, which is all a public image needs. */
export function registry(image, { retryMs = 1000 } = {}) {
  const [host, ...path] = image.split("/");
  const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https";
  const base = `${scheme}://${host}/v2/${path.join("/")}`;
  let token = null;

  async function login(challenge) {
    const params = Object.fromEntries([...(challenge ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    if (!params.realm) throw new Error(`${host} asked for credentials without saying where to get them`);

    const url = new URL(params.realm);
    for (const key of ["service", "scope"]) if (params[key]) url.searchParams.set(key, params[key]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url.origin} refused a token with ${res.status}`);
    const body = await res.json();
    return body.token ?? body.access_token;
  }

  function headers() {
    return token ? { Accept: MANIFESTS, Authorization: `Bearer ${token}` } : { Accept: MANIFESTS };
  }

  async function send(url, method) {
    for (let attempt = 1; ; attempt++) {
      try {
        let res = await fetch(url, { method, headers: headers() });
        if (res.status === 401) {
          token = await login(res.headers.get("www-authenticate"));
          res = await fetch(url, { method, headers: headers() });
        }
        if (res.status === 429 || res.status >= 500) throw new Error(`${url} answered ${res.status}`);
        return res;
      } catch (error) {
        if (attempt === ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * retryMs));
      }
    }
  }

  async function digest(tag) {
    const res = await send(`${base}/manifests/${tag}`, "HEAD");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${image}:${tag} answered ${res.status}`);
    const found = res.headers.get("docker-content-digest");
    if (!found) throw new Error(`${image}:${tag} came back without a digest`);
    return found;
  }

  async function tags() {
    const all = [];
    let url = `${base}/tags/list?n=1000`;
    while (url) {
      const res = await send(url, "GET");
      if (!res.ok) throw new Error(`${image}'s tag list answered ${res.status}`);
      const page = (await res.json()).tags ?? [];
      if (!page.length) break;
      all.push(...page);
      const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "");
      url = next ? new URL(next[1], base).href : null;
    }
    return all;
  }

  return { digest, tags };
}

async function main() {
  const [image, release] = process.argv.slice(2);
  if (!image?.includes("/") || !release) {
    console.error("usage: beta-follows-latest.mjs <image> <stable version>");
    process.exit(2);
  }
  const parsed = parseVersion(release);
  if (!parsed || parsed.pre.length) {
    console.error(`${release} is not a stable version, and only a stable release moves latest-beta.`);
    process.exit(2);
  }

  const images = registry(image);
  try {
    const target = await images.digest(release);
    if (!target) {
      console.error(`There is no ${image}:${release}, so there is nothing to point latest-beta at.`);
      process.exit(1);
    }
    const beta = await images.digest("latest-beta");
    console.error(`${image}:${release} is ${target}`);
    console.error(`${image}:latest-beta is ${beta ?? "not there"}`);

    if (beta === target) {
      console.error(`latest-beta is already ${release}.`);
      return;
    }

    const current = beta ? await versionOf(beta, await images.tags(), images.digest) : null;
    const { move, why } = decide(release, current);
    console.error(why);
    if (move) console.log(target);
  } catch (error) {
    console.error(`Could not read ${image} from its registry, so latest-beta was left where it is.`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
