#!/usr/bin/env node
/**
 * Fails when the server ships a permission the client has no words for.
 *
 * The server owns the list of permissions and sends it with the role editor
 * payload. The client owns the labels and the one-line descriptions, on
 * purpose — how a permission is worded is not the server's business. The
 * seam between them is unchecked, and when it slips the role editor puts the
 * permission in a group called "Newer than this client" and draws it as a bare
 * id. It saves and applies correctly the whole time. It just reads as a client
 * that is out of date.
 *
 * That has happened twice: `upload_avatar_image` in GRYT-866 and
 * `set_activity` in GRYT-929, the second caught by hand rather than by
 * anything running.
 *
 * Neither repository's CI can catch it, because neither can see the other.
 * This one can. Same reasoning as check-avatar-parity.sh next door.
 *
 * Usage: check-permission-labels.mjs
 *
 * Reads the two source files in place. The caller is responsible for having
 * packages/server and packages/client checked out at whatever refs it wants
 * compared; this script has no opinion about that.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT =
  process.env.GRYT_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SERVER_FILE = `${ROOT}/packages/server/src/constants/permissions.ts`;
const CLIENT_FILE = `${ROOT}/packages/client/src/packages/socket/src/lib/permissions.ts`;

/**
 * Both files are dense with comments, and the comments talk about permissions
 * by name. Stripping them first is the difference between reading the code and
 * reading the prose about the code.
 *
 * Crude on purpose: it does not understand a `//` inside a string literal.
 * Neither file has one, and a parser that did would be a dependency.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`No ${label} at ${path} — is the submodule checked out?`);
    process.exit(1);
  }
}

const problems = [];
function fail(message) {
  problems.push(message);
  console.error(`::error::${message}`);
}

/* ── the server's list ───────────────────────────────────────────────────── */

const serverSource = withoutComments(read(SERVER_FILE, "server permission catalogue"));

/*
 * Anchored on the declaration rather than on "the first array in the file".
 * The same file also holds MEMBER_PERMISSIONS and the backfill table, and
 * picking one of those up would compare the client against a subset — which
 * passes while saying nothing.
 */
const serverMatch = serverSource.match(
  /export const PERMISSIONS\b[^=]*=\s*\[([\s\S]*?)\n\]/,
);
if (!serverMatch) {
  fail(
    `Could not find "export const PERMISSIONS = [" in ${SERVER_FILE} — ` +
      "did the constant get renamed? This check reads the source as text, so a " +
      "rename makes it silently compare nothing.",
  );
  process.exit(1);
}

const serverPermissions = [...serverMatch[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);

/* ── the client's labels ─────────────────────────────────────────────────── */

const clientSource = withoutComments(read(CLIENT_FILE, "client permission labels"));

/*
 * Every entry the role editor can draw a name for. Matching on `id:` followed
 * by `label:` rather than on bare strings keeps PERMISSIONS_BEFORE_CATALOGUE
 * out of it — that list is a frozen record of an old release, not a set of
 * things this editor has words for.
 */
const clientLabelled = [
  ...clientSource.matchAll(/\{\s*id:\s*"([a-z0-9_]+)"\s*,\s*label:/g),
].map((m) => m[1]);

if (clientLabelled.length === 0) {
  fail(
    `Found no { id: "…", label: … } entries in ${CLIENT_FILE} — the shape of ` +
      "PERMISSION_GROUPS has changed and this check needs rewriting. Reporting " +
      "it rather than passing, because an empty list matches nothing and looks " +
      "like agreement.",
  );
  process.exit(1);
}

/* ── compare, in both directions ─────────────────────────────────────────── */

const labelled = new Set(clientLabelled);
const shipped = new Set(serverPermissions);

const unlabelled = serverPermissions.filter((p) => !labelled.has(p));
const orphaned = clientLabelled.filter((p) => !shipped.has(p));

console.log(`server ships ${serverPermissions.length} permissions`);
console.log(`client labels ${clientLabelled.length}`);

for (const permission of unlabelled) {
  fail(
    `${permission} is shipped by the server and has no label in the client — ` +
      'it will render as a bare id under "Newer than this client".',
  );
}

/*
 * The other direction is worth failing on too. A label for a permission the
 * server dropped is a switch the role editor offers and the server ignores,
 * which is a worse lie than a missing switch.
 */
for (const permission of orphaned) {
  fail(
    `${permission} is labelled in the client and the server does not ship it — ` +
      "the role editor offers a switch that does nothing.",
  );
}

const duplicates = clientLabelled.filter((p, i) => clientLabelled.indexOf(p) !== i);
for (const permission of new Set(duplicates)) {
  fail(`${permission} is labelled twice in the client — it will draw in two groups.`);
}

if (problems.length > 0) {
  console.error("");
  console.error("The role editor and the server disagree about what exists.");
  console.error(`Server: ${SERVER_FILE}`);
  console.error(`Client: ${CLIENT_FILE}`);
  process.exit(1);
}

console.log("");
console.log("Every permission the server ships has words in the client.");
