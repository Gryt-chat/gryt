/* eslint-env node */

/**
 * The two AUR PKGBUILDs are the same package twice, so they have to stay that
 * way apart from four lines.
 *
 * They are separate files rather than one generated from the other because the
 * AUR takes a literal PKGBUILD and publish-aur.yml copies one over. Nothing at
 * publish time compares them, and a depends= added to one and not the other
 * builds fine and installs a package missing a library.
 *
 * Also holds the three lines publish-aur.yml rewrites with anchored seds. Rename
 * one and the sed matches nothing, which publishes a package pointing at an old
 * release rather than failing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packaging", "aur");

const FULL = "gryt-chat-bin";
const SLIM = "gryt-chat-slim-bin";

const full = readFileSync(join(dir, "PKGBUILD"), "utf8");
const slim = readFileSync(join(dir, "PKGBUILD.slim"), "utf8");

const ALLOWED_TO_DIFFER = ["pkgname=", "pkgdesc=", "conflicts=", "source="];

// Comments carry the difference between the two headers, and blank lines move
// with them.
const code = (text) =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "" && !line.trimStart().startsWith("#"));

const a = code(full);
const b = code(slim);

assert.equal(
  a.length,
  b.length,
  `PKGBUILD has ${a.length} lines of code and PKGBUILD.slim has ${b.length}`,
);

for (const [i, line] of a.entries()) {
  if (line === b[i]) continue;

  assert.ok(
    ALLOWED_TO_DIFFER.some((key) => line.startsWith(key) && b[i].startsWith(key)),
    `the two PKGBUILDs differ on a line that is not one of ${ALLOWED_TO_DIFFER.join(", ")}:\n` +
      `  PKGBUILD:      ${line}\n` +
      `  PKGBUILD.slim: ${b[i]}`,
  );
}

for (const [name, text, pkgname, other] of [
  ["PKGBUILD", full, FULL, SLIM],
  ["PKGBUILD.slim", slim, SLIM, FULL],
]) {
  assert.match(text, new RegExp(`^pkgname=${pkgname}$`, "m"), `${name}: wrong pkgname`);

  // Both install /opt/Gryt Chat, so installing one over the other silently
  // overwrites its files.
  assert.match(
    text,
    new RegExp(`^conflicts=\\(.*'${other}'.*\\)$`, "m"),
    `${name}: must declare ${other} in conflicts`,
  );
  assert.match(text, /^provides=\('gryt-chat'\)$/m, `${name}: must provide gryt-chat`);

  // publish-aur.yml rewrites these three by anchored sed and then greps to
  // confirm the rewrite landed.
  assert.match(text, /^pkgver=\d+\.\d+\.\d+$/m, `${name}: no pkgver for the workflow to rewrite`);
  assert.match(text, /^pkgrel=\d+$/m, `${name}: no pkgrel for the workflow to rewrite`);
  assert.match(text, /^sha256sums=\('SKIP'\)$/m, `${name}: sha256sums is not the placeholder`);
}

const sourceOf = (text) => text.match(/^source=\("(.+)"\)$/m)?.[1];

assert.ok(
  sourceOf(full)?.endsWith("-linux-amd64.deb"),
  "PKGBUILD must build from the full deb",
);
assert.ok(
  sourceOf(slim)?.endsWith("-linux-amd64-slim.deb"),
  "PKGBUILD.slim must build from the slim deb",
);

console.log(`AUR PKGBUILDs: ok, ${FULL} and ${SLIM} agree`);
