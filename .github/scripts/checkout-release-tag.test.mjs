// checkout-release-tag.sh against a scratch repository: an "origin" with main and tags,
// and a clone of it standing in for the submodule, the shape both release workflows have.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT = new URL("checkout-release-tag.sh", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "release-tag-"));

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();

let n = 0;
function commit(repo) {
  writeFileSync(join(repo, "file"), String(++n));
  git(repo, "add", "file");
  git(repo, "commit", "--quiet", "-m", `commit ${n}`);
  return git(repo, "rev-parse", "HEAD");
}

/** An origin whose main carries each tag given, in order, plus one untagged commit on top. */
function origin(name, tags) {
  const repo = join(dir, name);
  git(dir, "init", "--quiet", "--initial-branch=main", repo);
  const at = {};
  for (const tag of tags) {
    at[tag] = commit(repo);
    git(repo, "tag", tag);
  }
  at.untagged = commit(repo);
  return { repo, at };
}

function clone(from, name) {
  const path = join(dir, name);
  git(dir, "clone", "--quiet", from.repo, path);
  return path;
}

/** Runs the script and hands back its exit code, its output, and where the clone ended up. */
function run(path, channel) {
  let code = 0;
  let out;
  try {
    out = execFileSync("bash", [SCRIPT, path, channel], { env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return { code, out, head: git(path, "rev-parse", "HEAD") };
}

test("latest takes the newest plain release, not a newer beta or main's untagged head", () => {
  const o = origin("latest", ["v1.0.0", "v1.0.1", "v1.1.0-beta.1"]);
  const r = run(clone(o, "latest-work"), "latest");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.head, o.at["v1.0.1"]);
  assert.match(r.out, /\(v1\.0\.1\)/);
});

test("beta takes the newest beta when it is ahead of the last stable", () => {
  const o = origin("beta", ["v1.0.0", "v1.0.1", "v1.1.0-beta.1"]);
  const r = run(clone(o, "beta-work"), "beta");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.head, o.at["v1.1.0-beta.1"]);
});

test("beta takes a stable that is newer than its own betas", () => {
  const o = origin("beta-stable", ["v1.1.0-beta.1", "v1.1.0-beta.2", "v1.1.0"]);
  const r = run(clone(o, "beta-stable-work"), "beta");
  assert.equal(r.head, o.at["v1.1.0"], "v1.1.0-beta.2 sorted above v1.1.0");
});

test("versions sort as numbers, so 1.0.10 is newer than 1.0.9", () => {
  const o = origin("numeric", ["v1.0.9", "v1.0.10"]);
  const r = run(clone(o, "numeric-work"), "latest");
  assert.equal(r.head, o.at["v1.0.10"]);
});

test("a tag made after the clone is fetched, which is how a fresh release reaches the next one", () => {
  const o = origin("fresh", ["v1.2.5"]);
  const path = clone(o, "fresh-work");
  git(o.repo, "tag", "v1.2.6", o.at.untagged);
  const r = run(path, "latest");
  assert.equal(r.head, o.at.untagged, "the tag pushed after cloning was not seen");
});

test("no release for the channel stops the run and says to release it first", () => {
  const o = origin("only-betas", ["v2.0.0-beta.1"]);
  const r = run(clone(o, "only-betas-work"), "latest");
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::No release tag in .* for the latest channel\. Release it first\./);
});

test("an unknown channel stops the run rather than picking something", () => {
  const o = origin("channel", ["v1.0.0"]);
  const r = run(clone(o, "channel-work"), "stable");
  assert.equal(r.code, 2);
  assert.match(r.out, /Unknown channel 'stable'/);
});

test("the clone is left detached at the tag, not on a branch that could be pushed", () => {
  const o = origin("detached", ["v1.0.0"]);
  const path = clone(o, "detached-work");
  run(path, "latest");
  assert.equal(git(path, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
});
