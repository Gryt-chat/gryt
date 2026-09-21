// The release gate against fixtures, never the network: GRYT_RELEASES_URL
// takes a path as readily as a URL. Nothing else exercises it.

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
function fixture(name, { app = [], server = [], voice = [], images = [] }) {
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
    Object.entries({ app, server, voice, images })
      .map(([surface, list]) => `export const ${surface}: ReleaseLine[] = [\n${entries(list)}\n];\n`)
      .join("\n"),
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
  app: [
    { version: "1.11.3", date: today },
    { version: "1.12.0-beta.1", date: today },
  ],
  server: [{ version: "1.7.0", date: today }],
  voice: [{ version: "1.0.65", date: today }],
  images: [{ version: "1.2.6", date: today }],
});

test("a line dated today passes", () => {
  const { code, out } = run(written, "app", "1.11.3");
  assert.equal(code, 0);
  assert.match(out, /app 1\.11\.3 has one/);
});

test("each surface reads its own array", () => {
  assert.equal(run(written, "server", "1.7.0").code, 0);

  /* 1.11.3 is the app's. Finding it under server would let a server release
     ride on the client's line. */
  const { code, out } = run(written, "server", "1.11.3");
  assert.equal(code, 1);
  assert.match(out, /No changelog line for server 1\.11\.3/);
});

test("voice and images read their own arrays too", () => {
  assert.equal(run(written, "voice", "1.0.65").code, 0);
  assert.equal(run(written, "images", "1.2.6").code, 0);

  /* The SFU and the image worker number their releases separately, so one's
     line must not pass the other's release. */
  const { code, out } = run(written, "images", "1.0.65");
  assert.equal(code, 1);
  assert.match(out, /No changelog line for images 1\.0\.65/);
  assert.equal(run(written, "voice", "1.2.6").code, 1);
});

test("a missing line fails, and says what to write", () => {
  const { code, out } = run(written, "app", "9.9.9");
  assert.equal(code, 1);
  assert.match(out, /No changelog line for app 9\.9\.9/);
  assert.match(out, /content\/changelog\/releases\.ts/);
  assert.match(out, new RegExp(`version: "9\\.9\\.9"`));
  assert.match(out, new RegExp(`date: "${today}"`));
  /* Only the app has the dialog that reads lines, and a changes array for it. */
  assert.match(out, /kind: "fixed"/);
  assert.match(out, /desktop app reads the line/);
  assert.match(out, /stops gryt\.chat deploying/);
  assert.doesNotMatch(out, /channel:/);
  for (const surface of ["server", "voice", "images"]) {
    const other = run(written, surface, "9.9.9");
    assert.equal(other.code, 1);
    assert.match(other.out, new RegExp(`No changelog line for ${surface} 9\\.9\\.9`));
    assert.doesNotMatch(other.out, /kind: "fixed"|desktop app/);
  }
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

test("an app prerelease needs its exact line", () => {
  const writtenBeta = run(written, "app", "1.12.0-beta.1");
  assert.equal(writtenBeta.code, 0);
  assert.match(writtenBeta.out, /app 1\.12\.0-beta\.1 has one/);

  const missingBeta = run(written, "app", "1.12.0-beta.2");
  assert.equal(missingBeta.code, 1);
  assert.match(missingBeta.out, /No changelog line for app 1\.12\.0-beta\.2/);
});

test("a missing app beta line is written as a beta, and doesn't claim to block the site", () => {
  const { code, out } = run(written, "app", "1.12.0-beta.2");
  assert.equal(code, 1);
  assert.match(out, new RegExp(`date: "${today}",\\n\\s*channel: "beta",`));
  assert.match(out, /desktop app reads the line/);
  /* The site's build only asks stable releases for a line. */
  assert.doesNotMatch(out, /gryt\.chat deploying/);
});

test("the entry it prints passes once it's pasted in", () => {
  for (const version of ["9.9.9", "9.9.9-beta.1"]) {
    const { out } = run(written, "app", version);
    const entry = out.slice(out.indexOf("  {\n"), out.indexOf("  },\n") + 4);
    const pasted = join(dir, `pasted-${version}.ts`);
    writeFileSync(pasted, `export const app: ReleaseLine[] = [\n${entry}\n];\n`);
    assert.equal(run(pasted, "app", version).code, 0, entry);
  }
});

test("non-app prereleases still need no line", () => {
  for (const surface of ["server", "voice", "images"]) {
    const { code, out } = run(written, surface, "9.9.9-beta.1");
    assert.equal(code, 0);
    assert.match(out, /prerelease, no line required/);
  }
});

test("a version is matched whole, not as a prefix", () => {
  assert.equal(run(written, "app", "1.11.30").code, 1);
});

test("the dots in a version are not wildcards", () => {
  /* Unescaped, 1.11.3 as a pattern also matches 1211x3. */
  const lookalike = fixture("lookalike", { app: [{ version: "1211x3", date: today }] });
  assert.equal(run(lookalike, "app", "1.11.3").code, 1);
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
  /* The SFU's surface is voice. A repository's name is the likeliest slip. */
  assert.equal(run(written, "sfu", "1.0.65").code, 2);
  assert.equal(run(written, "image-worker", "1.2.6").code, 2);
});
