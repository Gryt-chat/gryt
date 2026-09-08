/* eslint-env node */

/**
 * Every publish-*.yml is dispatched by Release Client. They listen for
 * `release: published`, which never fires for a release GITHUB_TOKEN published.
 */

/* A publisher missing from that list never runs and nothing goes red: v1.10.1
   shipped with AUR, Homebrew and winget untouched, two stores behind. GRYT-1058. */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workflows = join(dirname(fileURLToPath(import.meta.url)), "..", "workflows");

const publishers = readdirSync(workflows)
  .filter((f) => f.startsWith("publish-") && f.endsWith(".yml"))
  .sort();

assert.ok(publishers.length > 0, "no publish-*.yml found, so this check is looking in the wrong place");

const release = readFileSync(join(workflows, "release-client.yml"), "utf8");

// The step's own list, not the whole file: a publisher named only in a comment
// somewhere else must not count as dispatched.
const step = release.match(/for WF in \\\n([\s\S]*?)\n\s*do\n/);

assert.ok(
  step,
  "release-client.yml has no `for WF in ...` dispatch loop. If the fan-out moved, " +
    "move this check with it rather than deleting it.",
);

const dispatched = new Set(
  step[1]
    .split("\n")
    .map((line) => line.replace(/\\\s*$/, "").trim())
    .filter(Boolean),
);

const missing = publishers.filter((p) => !dispatched.has(p));

assert.deepEqual(
  missing,
  [],
  `these publishers exist but Release Client never dispatches them, so they will ` +
    `never run: ${missing.join(", ")}`,
);

const unknown = [...dispatched].filter((d) => !publishers.includes(d));

assert.deepEqual(
  unknown,
  [],
  `Release Client dispatches workflows that do not exist: ${unknown.join(", ")}`,
);

console.log(`publisher dispatch: ok, ${publishers.length} publishers, all dispatched`);
