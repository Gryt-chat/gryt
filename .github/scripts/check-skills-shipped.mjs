/* eslint-env node */

/**
 * Every skill CLAUDE.md names is in the repository. The rule was versioned and
 * the tool was not, and it went wrong twice with nothing to notice.
 */

/* `humanizer` was named until 2026-08-22 and never installed. `natural-writing`
   reached the Windows machine six days after the rule asked for it. */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const claudeMd = join(root, ".claude", "CLAUDE.md");
const skillsDir = join(root, ".claude", "skills");

const text = readFileSync(claudeMd, "utf8");

/**
 * Read off the paths rather than the prose: a backticked word is any word, where
 * `.claude/skills/<name>` is a claim that the repository carries it.
 */
const named = new Set(
  [...text.matchAll(/\.claude\/skills\/([a-z][a-z0-9-]*)/g)].map(([, name]) => name),
);

assert.ok(named.size > 0, "CLAUDE.md names no skills at all, which means this check stopped working");

const shipped = new Set(
  readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);

const missing = [...named].filter((name) => !shipped.has(name)).sort();

assert.deepEqual(
  missing,
  [],
  `CLAUDE.md requires these and the repository does not carry them:\n  ${missing.join("\n  ")}\n` +
    `Shipped: ${[...shipped].sort().join(", ")}`,
);

// A directory with no SKILL.md is not a skill, it is a folder.
for (const name of shipped) {
  assert.ok(
    existsSync(join(skillsDir, name, "SKILL.md")),
    `.claude/skills/${name}/ has no SKILL.md`,
  );
}

console.log(`skills shipped: ok, ${named.size} required, ${shipped.size} present`);
