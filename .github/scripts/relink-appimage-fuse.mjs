#!/usr/bin/env node
/**
 * Relink the Linux AppImages onto a runtime that does not need libfuse2.
 */

/* electron-builder 26.x builds a runtime that dlopens libfuse.so.2, and modern
   distributions ship fuse3 only, so the download is simply dead on most Linux. */

/* The static runtime that fixes it is the default only from electron-builder v27,
   still alpha, and a bump there has broken our updater before (GRYT-953). */

/* An AppImage is an ELF runtime with a squashfs after it, so this copies the
   payload onto a different header. Only the leading bytes change. */

/* In latest-linux.yml / slim-linux.yml per AppImage: files[].sha512 and
   files[].size, the top-level pair when path is it, and files[].blockMapSize goes. */

/* blockMapSize is dropped rather than recomputed: regenerating it would pull
   app-builder in, and the updater falls back to a full download it verifies. */

/* The caller hands over a runtime it has already checksum-verified, so this does no
   network. The workflow re-uploads over the draft release, which nobody can see. */

/*
 *   node relink-appimage-fuse.mjs --runtime <static-runtime> --dir <releaseDir>
 */

/* Run from packages/client, where js-yaml resolves. Exits non-zero and changes
   nothing if it finds no AppImage: a silent no-op would ship the broken file. */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(path.join(process.cwd(), "package.json"));
const yaml = require("js-yaml");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const runtimePath = arg("runtime");
const releaseDir = arg("dir") ?? "release";

if (!runtimePath || !fs.existsSync(runtimePath)) {
  console.error(`Missing or unreadable --runtime file: ${runtimePath}`);
  process.exit(1);
}
if (!fs.existsSync(releaseDir)) {
  console.error(`No release dir: ${releaseDir}`);
  process.exit(1);
}

const runtime = fs.readFileSync(runtimePath);

// electron-builder's Linux AppImages, full and -slim. Only x86_64 is built, so a
// suffix match is enough; deb and snap in here are left untouched.
const appImages = fs
  .readdirSync(releaseDir)
  .filter((n) => n.includes("-linux-") && n.toLowerCase().endsWith(".appimage"));

if (appImages.length === 0) {
  console.error(`No Linux AppImage found in ${releaseDir} — nothing to relink.`);
  process.exit(1);
}

/** sha512 as base64, the shape electron-updater writes and checks. */
function sha512b64(buf) {
  return crypto.createHash("sha512").update(buf).digest("base64");
}

// The payload offset is the size of the current runtime. Ask the AppImage rather
// than parsing the ELF: --appimage-offset needs no FUSE.
function payloadOffset(file) {
  // Absolute path: a bare name would be looked up in $PATH, and the exec bit
  // because a copied-in artifact may have lost it.
  const abs = path.resolve(file);
  fs.chmodSync(abs, 0o755);
  const out = execFileSync(abs, ["--appimage-offset"], { encoding: "utf8" });
  const offset = Number.parseInt(out.trim(), 10);
  if (!Number.isInteger(offset) || offset <= 0) {
    throw new Error(`Could not read AppImage offset from ${file}: "${out.trim()}"`);
  }
  return offset;
}

// Every Linux updater manifest in the dir. Names vary by channel and variant, so
// an AppImage is matched to its manifest by what the manifest points at.

// A beta build writes beta-linux.yml, and guessing "latest" would leave it
// unpatched while shipping an AppImage with a new sha512.
const ymlDocs = fs
  .readdirSync(releaseDir)
  .filter((n) => n.endsWith("-linux.yml"))
  .map((name) => ({
    name,
    doc: yaml.load(fs.readFileSync(path.join(releaseDir, name), "utf8")),
    dirty: false,
  }))
  .filter((y) => y.doc && typeof y.doc === "object");

let relinked = 0;

for (const name of appImages) {
  const file = path.join(releaseDir, name);
  const offset = payloadOffset(file);

  const original = fs.readFileSync(file);
  const payload = original.subarray(offset);
  const relinkedBuf = Buffer.concat([runtime, payload]);
  fs.writeFileSync(file, relinkedBuf);
  fs.chmodSync(file, 0o755);

  const sha512 = sha512b64(relinkedBuf);
  const size = relinkedBuf.length;

  let found = false;
  for (const y of ymlDocs) {
    const entry = (y.doc.files ?? []).find((f) => f.url === name);
    if (entry) {
      entry.sha512 = sha512;
      entry.size = size;
      delete entry.blockMapSize;
      y.dirty = true;
      found = true;
    }
    if (y.doc.path === name) {
      y.doc.sha512 = sha512;
      y.doc.size = size;
      y.dirty = true;
      found = true;
    }
  }
  if (!found) throw new Error(`No -linux.yml in ${releaseDir} references ${name}.`);

  console.log(
    `relinked ${name}: offset ${offset} -> ${runtime.length}, ` +
      `size ${original.length} -> ${size}`,
  );
  relinked += 1;
}

for (const y of ymlDocs) {
  if (!y.dirty) continue;
  fs.writeFileSync(path.join(releaseDir, y.name), yaml.dump(y.doc, { lineWidth: -1, noRefs: true }));
  console.log(`rewrote ${y.name}`);
}

console.log(`Relinked ${relinked} AppImage(s).`);
