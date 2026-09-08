/* eslint-env node */

/**
 * The two Homebrew casks are the same app twice, so they have to stay that way
 * apart from four lines.
 *
 * They are separate files because the tap takes a literal cask and
 * publish-homebrew.yml copies one over. Nothing at publish time compares them,
 * so a zap path added to one and not the other leaves half the people who
 * uninstall with an identity keypair still on disk.
 *
 * Also holds the three lines publish-homebrew.yml rewrites with anchored seds,
 * and the arch stanza. Drop that and both downloads become arm64, which is what
 * the cask did until Intel builds existed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packaging", "homebrew");

const FULL = "gryt-chat";
const SLIM = "gryt-chat-slim";

const full = readFileSync(join(dir, `${FULL}.rb`), "utf8");
const slim = readFileSync(join(dir, `${SLIM}.rb`), "utf8");

const ALLOWED_TO_DIFFER = ["cask ", "desc ", "conflicts_with ", "url "];

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
  `${FULL}.rb has ${a.length} lines of code and ${SLIM}.rb has ${b.length}`,
);

for (const [i, line] of a.entries()) {
  if (line === b[i]) continue;

  assert.ok(
    ALLOWED_TO_DIFFER.some((key) => line.trimStart().startsWith(key) && b[i].trimStart().startsWith(key)),
    `the two casks differ on a line that is not one of ${ALLOWED_TO_DIFFER.join(", ")}:\n` +
      `  ${FULL}.rb: ${line}\n` +
      `  ${SLIM}.rb: ${b[i]}`,
  );
}

const PLACEHOLDER_ARM = "0".repeat(64);
const PLACEHOLDER_INTEL = "1".repeat(64);

for (const [name, text, token, other] of [
  [`${FULL}.rb`, full, FULL, SLIM],
  [`${SLIM}.rb`, slim, SLIM, FULL],
]) {
  assert.match(text, new RegExp(`^cask "${token}" do$`, "m"), `${name}: wrong cask token`);

  // Same app bundle, so brew has to be told to pick one.
  assert.match(
    text,
    new RegExp(`^  conflicts_with cask: "${other}"$`, "m"),
    `${name}: must declare ${other} in conflicts_with`,
  );

  assert.match(
    text,
    /^  arch arm: "arm64", intel: "x64"$/m,
    `${name}: no arch stanza, so both arches would download the same file`,
  );
  assert.ok(
    !/depends_on arch:/.test(text),
    `${name}: depends_on arch: refuses to install on the arch it excludes`,
  );

  // publish-homebrew.yml rewrites these three by anchored sed and then greps to
  // confirm the rewrite landed.
  assert.match(text, /^  version "0\.0\.0"$/m, `${name}: version is not the placeholder`);
  assert.match(
    text,
    new RegExp(`^  sha256 arm: +"${PLACEHOLDER_ARM}",$`, "m"),
    `${name}: the arm checksum placeholder changed`,
  );
  assert.match(
    text,
    new RegExp(`^ +intel: "${PLACEHOLDER_INTEL}"$`, "m"),
    `${name}: the intel checksum placeholder changed`,
  );
}

const urlOf = (text) => text.match(/^  url "(.+)"$/m)?.[1];

for (const [name, url] of [
  [`${FULL}.rb`, urlOf(full)],
  [`${SLIM}.rb`, urlOf(slim)],
]) {
  assert.ok(url?.includes("-mac-#{arch}"), `${name}: the url does not interpolate the arch`);
}

assert.ok(urlOf(full)?.endsWith("#{arch}.dmg"), `${FULL}.rb must download the full DMG`);
assert.ok(urlOf(slim)?.endsWith("#{arch}-slim.dmg"), `${SLIM}.rb must download the slim DMG`);

console.log(`Homebrew casks: ok, ${FULL} and ${SLIM} agree`);
