#!/usr/bin/env node
/**
 * Does `build/server-api` still describe every socket event the server has? It is
 * hand-written, and had fallen to 114 of 211 without anything noticing.
 */

/* Whole features were missing — direct messages, threads, forums and calls, all
   four documented now. */

/* Not generated, deliberately: the page is organised by what somebody is trying to
   do and reads well, where generating it would give 211 alphabetical rows. */

/* Run it with --list to see what is missing rather than only how much. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SERVER = "packages/server/src";
const PAGE = "packages/docs/content/docs/build/server-api.mdx";

/**
 * Events the server never speaks, so their absence is not a gap.
 */

/* `connect`, `disconnect` and friends are Socket.IO's own. The rest are names
   built at runtime from a variable, which this cannot resolve. */
const NOT_OURS = new Set([
  "connect", "disconnect", "connect_error", "disconnecting", "error",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/**
 * Three registration styles, because the server uses all three: a key in an
 * EventHandlerMap, a direct socket.on, and socket.emit for server to client.
 */

/* A first pass counted only the first style and reported that two documented
   events did not exist. Both were real, registered the second way. */
function eventsInSource() {
  const found = new Map();

  for (const file of walk(SERVER)) {
    const text = readFileSync(file, "utf8");
    const short = file.replace(`${SERVER}/`, "");

    const add = (name, kind) => {
      if (NOT_OURS.has(name)) return;
      if (!found.has(name)) found.set(name, { kind, file: short });
    };

    for (const m of text.matchAll(/^\s*['"]([a-z][a-zA-Z]*:[a-zA-Z:_.-]+)['"]\s*:/gm)) {
      add(m[1], "handler");
    }
    for (const m of text.matchAll(/\.on\(\s*['"]([a-z][a-zA-Z]*:[a-zA-Z:_.-]+)['"]/g)) {
      add(m[1], "handler");
    }
    /* Any emit-ish call, not only `.emit(`: calls.ts sends through a local
       `emitTo(...)` helper, and three events were missed without this. */
    for (const m of text.matchAll(/emit[A-Za-z]*\(\s*(?:[^,()]{1,60},\s*)?['"]([a-zA-Z]+:[a-zA-Z:_.-]+)['"]/g)) {
      add(m[1], "emit");
    }
  }

  return found;
}

/** Anything in a backtick on the page counts as documented. */
function eventsInPage() {
  const text = readFileSync(PAGE, "utf8");
  return new Set(
    [...text.matchAll(/`([a-zA-Z]+:[a-zA-Z:_.-]+)`/g)].map((m) => m[1]),
  );
}

const source = eventsInSource();
const documented = eventsInPage();

const missing = [...source.keys()].filter((e) => !documented.has(e)).sort();
const stale = [...documented].filter((e) => !source.has(e)).sort();

const covered = source.size - missing.length;
const pct = Math.round((covered / source.size) * 100);

console.log(`socket coverage: ${covered}/${source.size} events documented (${pct}%)`);

if (stale.length > 0) {
  console.log(`\n${stale.length} documented but not in the source:`);
  for (const e of stale) console.log(`  ${e}`);
}

if (missing.length > 0) {
  const byPrefix = new Map();
  for (const e of missing) {
    const p = e.split(":")[0];
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }

  console.log(`\n${missing.length} in the source, not on the page:`);
  for (const [p, n] of [...byPrefix].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${p}:*`);
  }

  if (process.argv.includes("--list")) {
    console.log();
    for (const e of missing) console.log(`  ${e.padEnd(34)} ${source.get(e).file}`);
  } else {
    console.log("\nRun with --list to see them, and which file each is in.");
  }
}

/**
 * A floor rather than a target. Failing under 100% would go red the moment
 * somebody adds an event, which trains people to ignore it.
 */

/* So it fails only when coverage gets worse than it is today, and the number can
   be raised as the page catches up. */
const FLOOR = 70;

if (stale.length > 0) {
  console.error(`\nThe page describes ${stale.length} events the server does not have.`);
  process.exit(1);
}

if (pct < FLOOR) {
  console.error(`\nCoverage fell below ${FLOOR}%. Document the new events, or say why not.`);
  process.exit(1);
}
