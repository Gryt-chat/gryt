/**
 * The release gate, against fixtures rather than the live site. It never
 * reaches the network: GRYT_RELEASES_URL takes a path as readily as a URL.
 *
 * The gate is the only thing standing between a dispatched release and a
 * gryt.chat deploy that stops until somebody writes a line, and nothing else
 * exercises it — a release either passes it or is the test.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT = new URL("check-release-line.mjs", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "release-line-"));
const today = new Date().toISOString().slice(0, 10);

/** A releases.ts holding exactly the entries given, in the site's shape. */
function fixture(name, { app = [], server = [] }) {
  const entries = (list) =>
    list
      .map(
        ({ version, date, line = "Something changed." }) =>
          `  {\n    version: "${version}",\n` +
          (date === null ? "" : `    date: "${date}",\n`) +
          `    line: "${line}",\n  },`,
      )
      .join("\n");

  const path = join(dir, `${name}.ts`);
  writeFileSync(
    path,
    `export const app: ReleaseLine[] = [\n${entries(app)}\n];\n\n` +
      `export const server: ReleaseLine[] = [\n${entries(server)}\n];\n`,
  );
  return path;
}

/** Runs the gate and hands back its exit code and combined output. */
function run(source, ...args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      env: { ...process.env, GRYT_RELEASES_URL: source },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const written = fixture("written", {
  app: [{ version: "1.11.3", date: today }],
  server: [{ version: "1.7.0", date: today }],
});

test("a line dated today passes", () => {
  const { code, out } = run(written, "app", "1.11.3");
  assert.equal(code, 0);
  assert.match(out, /app 1\.11\.3 has one/);
});

test("each surface reads its own array", () => {
  assert.equal(run(written, "server", "1.7.0").code, 0);

  /* 1.11.3 is the app's. Finding it under server would let a server release
     ride on a line written for the client. */
  const { code, out } = run(written, "server", "1.11.3");
  assert.equal(code, 1);
  assert.match(out, /No changelog line for server 1\.11\.3/);
});

test("a missing line fails, and says what to write", () => {
  const { code, out } = run(written, "app", "9.9.9");
  assert.equal(code, 1);
  assert.match(out, /No changelog line for app 9\.9\.9/);
  assert.match(out, /content\/changelog\/releases\.ts/);
  assert.match(out, new RegExp(`version: "9\\.9\\.9"`));
  assert.match(out, new RegExp(`date: "${today}"`));
  /* The app has the dialog that reads them; the server has no changes array. */
  assert.match(out, /kind: "fixed"/);
  assert.doesNotMatch(run(written, "server", "9.9.9").out, /kind: "fixed"/);
});

test("a line dated some other day fails", () => {
  const stale = fixture("stale", { app: [{ version: "1.11.4", date: "2026-01-02" }] });
  const { code, out } = run(stale, "app", "1.11.4");
  assert.equal(code, 1);
  assert.match(out, /dated 2026-01-02, and today is/);
});

test("a version with no date after it fails as malformed", () => {
  const shapeless = fixture("shapeless", { app: [{ version: "1.11.5", date: null }] });
  const { code, out } = run(shapeless, "app", "1.11.5");
  assert.equal(code, 1);
  assert.match(out, /no date directly after its version/);
});

test("a prerelease needs no line", () => {
  const { code, out } = run(written, "app", "1.12.0-beta.1");
  assert.equal(code, 0);
  assert.match(out, /prerelease, no line required/);
});

test("a version is matched whole, not as a prefix", () => {
  /* 1.11.3 must not satisfy 1.11.30, and the dots are not wildcards. */
  assert.equal(run(written, "app", "1.11.30").code, 1);
  assert.equal(run(written, "app", "1211x3").code, 1);
});

test("a source it cannot read fails, and says the check did not run", () => {
  const { code, out } = run(join(dir, "not-here.ts"), "app", "1.11.3");
  assert.equal(code, 1);
  assert.match(out, /the check itself did not run/);
});

test("a source with no such array fails rather than passing", () => {
  const empty = join(dir, "empty.ts");
  writeFileSync(empty, "export const voice: ReleaseLine[] = [\n];\n");
  const { code, out } = run(empty, "app", "1.11.3");
  assert.equal(code, 1);
  assert.match(out, /Could not find the app releases/);
});

test("bad arguments exit 2, so a mistake is not read as a missing line", () => {
  assert.equal(run(written, "app").code, 2);
  assert.equal(run(written).code, 2);
  assert.equal(run(written, "voice", "1.0.0").code, 2);
});
