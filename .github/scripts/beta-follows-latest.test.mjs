// The version comparison on its own, then the script against a throwaway registry on
// 127.0.0.1. Nothing here reaches GHCR.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { compareVersions, decide, versionOf } from "./beta-follows-latest.mjs";

const SCRIPT = new URL("beta-follows-latest.mjs", import.meta.url).pathname;
const execute = promisify(execFile);

test("an older beta moves to the release", () => {
  const { move, why } = decide("1.10.14", "1.8.16-beta.1");
  assert.equal(move, true);
  assert.match(why, /1\.8\.16-beta\.1, older than 1\.10\.14/);
});

test("a beta of a higher version stays", () => {
  const { move, why } = decide("1.10.14", "1.11.0-beta.2");
  assert.equal(move, false);
  assert.match(why, /1\.11\.0-beta\.2, newer than 1\.10\.14/);
});

test("the same version stays", () => {
  const { move, why } = decide("1.10.14", "1.10.14");
  assert.equal(move, false);
  assert.match(why, /already 1\.10\.14/);
});

test("a beta of the release itself is older than the release", () => {
  assert.equal(decide("1.10.14", "1.10.14-beta.3").move, true);
});

test("a missing or unreadable version moves", () => {
  for (const current of [null, undefined, "", "latest", "1.10", "sha256-5aae629d"]) {
    assert.equal(decide("1.10.14", current).move, true, `latest-beta at ${current}`);
  }
});

test("only a stable release is followed", () => {
  assert.throws(() => decide("1.11.0-beta.1", "1.10.14"), /not a stable version/);
  assert.throws(() => decide("latest", "1.10.14"), /not a stable version/);
});

test("versions compare by semver precedence rather than as strings", () => {
  const shuffled = [
    "1.11.0", "1.10.14-beta.3", "1.0.104-beta.1", "1.11.0-beta.10", "1.9.0",
    "1.11.0-rc.1", "1.8.16-beta.1", "1.10.14", "1.0.104-beta", "1.11.0-beta.2",
  ];
  assert.deepEqual(shuffled.sort(compareVersions), [
    "1.0.104-beta", "1.0.104-beta.1", "1.8.16-beta.1", "1.9.0", "1.10.14-beta.3",
    "1.10.14", "1.11.0-beta.2", "1.11.0-beta.10", "1.11.0-rc.1", "1.11.0",
  ]);
});

test("latest-beta's version is the highest version tag on its digest, looked up newest first", async () => {
  const digests = {
    latest: "sha256:new",
    "1.10": "sha256:new",
    "1.10.14": "sha256:new",
    "1.10.13": "sha256:old",
    "1.8.16-beta.1": "sha256:beta",
  };
  const asked = [];
  const digestOf = async (tag) => {
    asked.push(tag);
    return digests[tag] ?? null;
  };

  assert.equal(await versionOf("sha256:old", Object.keys(digests), digestOf), "1.10.13");
  assert.deepEqual(asked, ["1.10.14", "1.10.13"]);
  assert.equal(await versionOf("sha256:pushed-by-hand", Object.keys(digests), digestOf), null);
});

/** One repository, gryt-chat/server, whose `tags` map each tag to a digest. Tokens work the way GHCR's do. */
async function fakeRegistry(tags, { status } = {}) {
  let port;
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const manifest = /^\/v2\/gryt-chat\/server\/manifests\/(.+)$/.exec(url.pathname);

    if (status) {
      res.writeHead(status).end();
    } else if (url.pathname === "/token") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token: "t0ken" }));
    } else if (req.headers.authorization !== "Bearer t0ken") {
      const challenge = `Bearer realm="http://127.0.0.1:${port}/token",service="fake",scope="repository:gryt-chat/server:pull"`;
      res.writeHead(401, { "www-authenticate": challenge }).end();
    } else if (url.pathname === "/v2/gryt-chat/server/tags/list") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tags: Object.keys(tags) }));
    } else if (manifest && tags[manifest[1]]) {
      res.writeHead(200, { "docker-content-digest": tags[manifest[1]] }).end();
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  return { image: `127.0.0.1:${port}/gryt-chat/server`, close: () => server.close() };
}

async function follow(image, version) {
  try {
    const { stdout, stderr } = await execute("node", [SCRIPT, image, version]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

const RELEASED = {
  latest: "sha256:new",
  "1.10": "sha256:new",
  "1.10.14": "sha256:new",
  "1.10.13": "sha256:old",
  "1.8.16-beta.1": "sha256:beta",
  "1.11.0-beta.2": "sha256:next",
};

test("the script prints the release's digest when latest-beta is older", async (t) => {
  const registry = await fakeRegistry({ ...RELEASED, "latest-beta": "sha256:beta" });
  t.after(registry.close);

  const { code, stdout, stderr } = await follow(registry.image, "1.10.14");
  assert.equal(code, 0);
  assert.equal(stdout, "sha256:new\n");
  assert.match(stderr, /1\.8\.16-beta\.1, older than 1\.10\.14/);
});

test("the script prints nothing when latest-beta is newer, and says why", async (t) => {
  const registry = await fakeRegistry({ ...RELEASED, "latest-beta": "sha256:next" });
  t.after(registry.close);

  const { code, stdout, stderr } = await follow(registry.image, "1.10.14");
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /1\.11\.0-beta\.2, newer than 1\.10\.14, so it stays/);
});

test("the script prints nothing when latest-beta is already the release", async (t) => {
  const registry = await fakeRegistry({ ...RELEASED, "latest-beta": "sha256:new" });
  t.after(registry.close);

  const { code, stdout, stderr } = await follow(registry.image, "1.10.14");
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /already 1\.10\.14/);
});

test("the script prints the release's digest when there is no latest-beta, or no version on it", async (t) => {
  const missing = await fakeRegistry(RELEASED);
  t.after(missing.close);
  assert.equal((await follow(missing.image, "1.10.14")).stdout, "sha256:new\n");

  const tagless = await fakeRegistry({ ...RELEASED, "latest-beta": "sha256:pushed-by-hand" });
  t.after(tagless.close);
  const { code, stdout, stderr } = await follow(tagless.image, "1.10.14");
  assert.equal(code, 0);
  assert.equal(stdout, "sha256:new\n");
  assert.match(stderr, /no version to compare/);
});

test("the script fails and prints nothing when the release has no image", async (t) => {
  const registry = await fakeRegistry({ ...RELEASED, "latest-beta": "sha256:beta" });
  t.after(registry.close);

  const { code, stdout, stderr } = await follow(registry.image, "1.10.15");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /There is no .*:1\.10\.15/);
});

test("the script fails and prints nothing when the registry is down", async (t) => {
  const registry = await fakeRegistry(RELEASED, { status: 503 });
  t.after(registry.close);

  const { code, stdout, stderr } = await follow(registry.image, "1.10.14");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /latest-beta was left where it is/);
});

test("the script refuses a prerelease or a missing argument", async () => {
  assert.equal((await follow("127.0.0.1:9/gryt-chat/server", "1.11.0-beta.1")).code, 2);
  assert.equal((await follow("127.0.0.1:9/gryt-chat/server", "")).code, 2);
});
