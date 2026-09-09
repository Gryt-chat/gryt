/* eslint-env node */

/**
 * The winget manifests match Microsoft's schema, with the placeholders filled.
 * The far end is a review queue, where a mistake costs a person's time.
 */

/* A bare 64-zero checksum parses as the integer 0 rather than a string, so the
   file is invalid as committed and the error only appears at submission. */

/* The three manifests carry the version three times, so one that stops being
   rewritten points at a release that does not exist. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "Gryt.GrytChat";

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packaging",
  "winget",
  PACKAGE,
);

const KINDS = {
  "": "version",
  ".installer": "installer",
  ".locale.en-US": "defaultLocale",
};

const PLACEHOLDER_VERSION = "0.0.0";
const PLACEHOLDER_SHA = "0".repeat(64);

const read = (kind) => readFileSync(join(dir, `${PACKAGE}${kind}.yaml`), "utf8");

for (const [kind, type] of Object.entries(KINDS)) {
  const file = `${PACKAGE}${kind}.yaml`;
  const text = read(kind);

  assert.match(
    text,
    new RegExp(`^PackageIdentifier: ${PACKAGE.replace(/\./g, "\\.")}$`, "m"),
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

const installer = read(".installer");

// Quoted, or YAML reads it as a number and the schema rejects it.
assert.match(
  installer,
  new RegExp(`InstallerSha256: "${PLACEHOLDER_SHA}"`),
  "the checksum placeholder must be quoted, or YAML parses 64 zeros as the integer 0",
);

assert.ok(
  installer.includes(`releases/download/v${PLACEHOLDER_VERSION}/`) &&
    installer.includes(`Gryt-Chat-${PLACEHOLDER_VERSION}-win-x64.exe`),
  "the installer URL must carry the version placeholder twice, tag and filename",
);

// The stores carry the full build. Slim stays on the release and on the site.
assert.ok(
  !installer.includes("-win-x64-slim.exe"),
  "the installer points at the slim build; the stores ship full",
);

console.log(`winget manifests: ok, ${Object.keys(KINDS).length} files`);
