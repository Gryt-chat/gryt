// No comment may run past two lines. Storytelling, history and restated types
// belong in git, in a task, or nowhere. See .claude/CLAUDE.md in the superproject.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 2;
const EMPTY = /^(\/\*+|\*+\/?|\/\/|#)$|[─=]{3,}\s*\*?\/?$/;

/* Paths not swept yet. Delete an entry once that directory is clean. */
const NOT_YET = [];

const ROOTS = ["ops", "scripts", ".github/workflows"];
const SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", ".git"]);
const CODE = /\.(ts|tsx|js|mjs|cjs|jsx)$/;
const HASH = /\.(ya?ml|sh|conf|env)$/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (CODE.test(name) || HASH.test(name)) out.push(full);
  }
  return out;
}

// A run is consecutive comment lines: one block comment, or a stack of // lines.
// Only lines carrying words count: `/**`, `*/` and a ── section rule are free.
function runs(text, hash) {
  const lines = text.split("\n");
  const found = [];
  let start = -1;
  let length = 0;
  let inBlock = false;

  const close = () => {
    if (length > LIMIT) found.push({ line: start + 1, length });
    start = -1;
    length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let comment = false;

    if (inBlock) {
      comment = true;
      if (line.includes("*/")) inBlock = false;
    } else if (!hash && line.startsWith("/*")) {
      comment = true;
      if (!line.includes("*/")) inBlock = true;
    } else if (!hash && line.startsWith("//")) {
      comment = true;
    } else if (hash && line.startsWith("#") && !line.startsWith("#!")) {
      comment = true;
    }

    if (comment) {
      if (start === -1) start = i;
      if (!EMPTY.test(line)) length++;
    } else if (start !== -1) {
      close();
    }
  }
  if (start !== -1) close();
  return found;
}

const offenders = [];
for (const root of ROOTS) {
  let entries;
  try {
    entries = files(root);
  } catch {
    continue;
  }
  for (const file of entries) {
    if (NOT_YET.some((prefix) => file.startsWith(prefix))) continue;
    const text = readFileSync(file, "utf8");
    for (const run of runs(text, HASH.test(file))) {
      offenders.push(`${file}:${run.line} — ${run.length} lines`);
    }
  }
}

if (offenders.length > 0) {
  console.error(`${offenders.length} comments longer than ${LIMIT} lines:\n`);
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

console.log("comments: none longer than two lines");
