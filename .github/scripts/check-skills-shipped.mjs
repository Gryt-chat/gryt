/* eslint-env node */

/**
 * Every skill CLAUDE.md names is in the repository.
 *
 * The rule was versioned and the tool was not, and it went wrong twice with
 * nothing to notice. `humanizer` was named until 2026-08-22 and was never on the
 * Windows machine. `natural-writing` was written 2026-08-28 and reached that
 * machine on 2026-09-03, and the Microsoft Store copy was written inside the
 * gap, without contractions and with a phrase the skill's own examples call out.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const claudeMd = join(root, ".claude", "CLAUDE.md");
const skillsDir = join(root, ".claude", "skills");

const text = readFileSync(claudeMd, "utf8");

/**
 * Read off the paths rather than the prose. A backticked word is any word;
 * `.claude/skills/<name>` is a claim that the repository carries it, which is
 * the thing being checked.
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
