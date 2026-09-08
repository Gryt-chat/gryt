/* eslint-env node */

/**
 * The winget manifests match Microsoft's schema, with the placeholders filled.
 *
 * Two things this catches that reading them does not. A bare 64-zero checksum
 * parses as the integer 0 rather than a string, so the file is invalid as
 * committed and the error only appears at submission. And the three manifests
 * carry the version three times, so one that stops being rewritten points at a
 * release that does not exist.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, "packaging", "winget");

const FILES = {
  "Gryt.GrytChat.yaml": "version",
  "Gryt.GrytChat.installer.yaml": "installer",
  "Gryt.GrytChat.locale.en-US.yaml": "defaultLocale",
};

const PLACEHOLDER_VERSION = "0.0.0";
const PLACEHOLDER_SHA = "0".repeat(64);

for (const [file, type] of Object.entries(FILES)) {
  const text = readFileSync(join(dir, file), "utf8");

  assert.match(
    text,
    /^PackageIdentifier: Gryt\.GrytChat$/m,
    `${file}: every manifest carries the same PackageIdentifier`,
  );
  assert.match(text, new RegExp(`^ManifestType: ${type}$`, "m"), `${file}: wrong ManifestType`);
  assert.match(text, /^ManifestVersion: \d+\.\d+\.\d+$/m, `${file}: no ManifestVersion`);
  assert.match(
    text,
    new RegExp(`^PackageVersion: ${PLACEHOLDER_VERSION.replace(/\./g, "\\.")}$`, "m"),
    `${file}: PackageVersion is not the placeholder the workflow rewrites`,
  );
}

const installer = readFileSync(join(dir, "Gryt.GrytChat.installer.yaml"), "utf8");

// Quoted, or YAML reads it as a number and the schema rejects it.
assert.match(
  installer,
  new RegExp(`InstallerSha256: "${PLACEHOLDER_SHA}"`),
  "the checksum placeholder must be quoted, or YAML parses 64 zeros as the integer 0",
);

assert.ok(
  installer.includes(`releases/download/v${PLACEHOLDER_VERSION}/`) &&
    installer.includes(`Gryt-Chat-${PLACEHOLDER_VERSION}-win-x64-slim.exe`),
  "the installer URL must carry the version placeholder twice, tag and filename",
);

// Slim, matching the site and the Homebrew cask.
assert.ok(
  !installer.includes("-win-x64.exe"),
  "the installer points at the full build; the site and the cask ship slim",
);

console.log(`winget manifests: ok, ${Object.keys(FILES).length} files`);
