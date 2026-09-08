/* eslint-env node */

/**
 * The winget manifests match Microsoft's schema, with the placeholders filled,
 * and the two packages stay the same app twice.
 *
 * Three things this catches that reading them does not. A bare 64-zero checksum
 * parses as the integer 0 rather than a string, so the file is invalid as
 * committed and the error only appears at submission. The three manifests carry
 * the version three times, so one that stops being rewritten points at a release
 * that does not exist. And the far end is somebody else's review queue, where a
 * mistake costs a person's time rather than a re-run.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packaging", "winget");

const FULL = "Gryt.GrytChat";
const SLIM = "Gryt.GrytChat.Slim";

const KINDS = {
  "": "version",
  ".installer": "installer",
  ".locale.en-US": "defaultLocale",
};

const PLACEHOLDER_VERSION = "0.0.0";
const PLACEHOLDER_SHA = "0".repeat(64);

const read = (pkg, kind) => readFileSync(join(dir, pkg, `${pkg}${kind}.yaml`), "utf8");

for (const pkg of [FULL, SLIM]) {
  for (const [kind, type] of Object.entries(KINDS)) {
    const file = `${pkg}${kind}.yaml`;
    const text = read(pkg, kind);

    assert.match(
      text,
      new RegExp(`^PackageIdentifier: ${pkg.replace(/\./g, "\\.")}$`, "m"),
      `${file}: every manifest in a package carries the same PackageIdentifier`,
    );
    assert.match(text, new RegExp(`^ManifestType: ${type}$`, "m"), `${file}: wrong ManifestType`);
    assert.match(text, /^ManifestVersion: \d+\.\d+\.\d+$/m, `${file}: no ManifestVersion`);
    assert.match(
      text,
      new RegExp(`^PackageVersion: ${PLACEHOLDER_VERSION.replace(/\./g, "\\.")}$`, "m"),
      `${file}: PackageVersion is not the placeholder the workflow rewrites`,
    );
  }

  const installer = read(pkg, ".installer");

  // Quoted, or YAML reads it as a number and the schema rejects it.
  assert.match(
    installer,
    new RegExp(`InstallerSha256: "${PLACEHOLDER_SHA}"`),
    `${pkg}: the checksum placeholder must be quoted, or YAML parses 64 zeros as the integer 0`,
  );

  assert.ok(
    installer.includes(`releases/download/v${PLACEHOLDER_VERSION}/`),
    `${pkg}: the installer URL must carry the version placeholder in the tag`,
  );
}

// Each package installs the same app under its own identifier, so `winget
// install gryt` has to mean one of them.
const monikerOf = (text) => text.match(/^Moniker: (.+)$/m)?.[1];

assert.notEqual(
  monikerOf(read(FULL, ".locale.en-US")),
  monikerOf(read(SLIM, ".locale.en-US")),
  "the two packages share a Moniker, so `winget install <moniker>` is ambiguous",
);

const urlOf = (text) => text.match(/^ *InstallerUrl: (.+)$/m)?.[1];

assert.ok(
  urlOf(read(FULL, ".installer"))?.endsWith(`-win-x64.exe`),
  `${FULL} must install the full build`,
);
assert.ok(
  urlOf(read(SLIM, ".installer"))?.endsWith(`-win-x64-slim.exe`),
  `${SLIM} must install the slim build`,
);

// Same app twice, and nothing at submission compares them. A Scope or an
// UpgradeBehavior fixed in one is a bug left in the other.
const ALLOWED_TO_DIFFER = [
  "PackageIdentifier:",
  "InstallerUrl:",
  "PackageName:",
  "ShortDescription:",
  "Moniker:",
];

const code = (text) =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "" && !line.trimStart().startsWith("#"));

for (const kind of Object.keys(KINDS)) {
  const a = code(read(FULL, kind));
  const b = code(read(SLIM, kind));

  assert.equal(
    a.length,
    b.length,
    `${FULL}${kind}.yaml has ${a.length} lines and ${SLIM}${kind}.yaml has ${b.length}`,
  );

  for (const [i, line] of a.entries()) {
    if (line === b[i]) continue;

    assert.ok(
      ALLOWED_TO_DIFFER.some(
        (key) => line.trimStart().startsWith(key) && b[i].trimStart().startsWith(key),
      ),
      `${kind || ".version"} manifests differ on a line that is not one of ` +
        `${ALLOWED_TO_DIFFER.join(", ")}:\n  ${FULL}: ${line}\n  ${SLIM}: ${b[i]}`,
    );
  }
}

console.log(`winget manifests: ok, ${FULL} and ${SLIM}, ${Object.keys(KINDS).length} files each`);
