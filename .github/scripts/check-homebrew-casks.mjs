/* eslint-env node */

/**
 * The cask still downloads a file per architecture, and still carries the three
 * lines publish-homebrew.yml rewrites.
 *
 * The arch stanza is the part worth a check. Drop it and both Macs get the
 * arm64 disk image, which is what the cask did until Intel builds existed and
 * which fails at the point somebody opens it rather than at build time.
 *
 * The seds are anchored on `version`, `sha256 arm:` and `intel:`, and the
 * workflow greps afterwards to confirm each landed. Rename one of those and the
 * sed matches nothing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packaging",
  "homebrew",
  "gryt-chat.rb",
);

const cask = readFileSync(file, "utf8");

assert.match(cask, /^cask "gryt-chat" do$/m, "wrong cask token");

assert.match(
  cask,
  /^  arch arm: "arm64", intel: "x64"$/m,
  "no arch stanza, so both architectures would download the same file",
);
assert.ok(
  !/depends_on arch:/.test(cask),
  "depends_on arch: refuses to install on the arch it excludes",
);

assert.match(cask, /^  version "0\.0\.0"$/m, "version is not the placeholder");
assert.match(
  cask,
  new RegExp(`^  sha256 arm: +"${"0".repeat(64)}",$`, "m"),
  "the arm checksum placeholder changed",
);
assert.match(
  cask,
  new RegExp(`^ +intel: "${"1".repeat(64)}"$`, "m"),
  "the intel checksum placeholder changed",
);

const url = cask.match(/^  url "(.+)"$/m)?.[1];

assert.ok(url?.includes("-mac-#{arch}"), "the url does not interpolate the arch");
// The stores carry the full build. Slim stays on the release and on the site.
assert.ok(url?.endsWith("#{arch}.dmg"), "the cask must download the full DMG");

console.log("Homebrew cask: ok");
