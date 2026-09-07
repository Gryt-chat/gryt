#!/usr/bin/env node
/**
 * Relink the Linux AppImages onto a runtime that does not need libfuse2.
 *
 * electron-builder 26.x builds AppImages with a runtime that dynamically loads
 * libfuse.so.2. Modern distributions ship fuse3 and no longer install fuse2, so
 * a fresh Arch/CachyOS, Fedora, or Ubuntu 24.04+ machine cannot launch the file
 * at all: double-clicking does nothing, and a terminal shows
 *
 *   dlopen(): error loading libfuse.so.2
 *   AppImages require FUSE to run.
 *
 * The file manager swallows that stderr, so to a normal user the download is
 * simply dead. This is most Linux users, not an edge case. The static runtime
 * that fixes it is only the default from electron-builder v27, which is still
 * alpha — and a bump there has broken our updater before (GRYT-953). So instead
 * of moving electron-builder, this reattaches the finished AppImage to the
 * FUSE3-static "type2" runtime after the build.
 *
 * An AppImage is just an ELF runtime with a squashfs filesystem concatenated
 * after it. Swapping the runtime is therefore a byte-for-byte copy of the
 * payload (the squashfs, plus electron-builder's appended block-map trailer)
 * onto a different header. The app itself is not rebuilt or recompressed, so
 * nothing inside it can change. Only the file's leading bytes differ, which
 * means its sha512 and size change and the updater metadata has to follow.
 *
 * What it rewrites in latest-linux.yml / slim-linux.yml for each AppImage:
 *   - files[].sha512 and files[].size          (the download the updater fetches)
 *   - top-level sha512 / size when path is it  (the default entry)
 *   - removes files[].blockMapSize             (see below)
 *
 * blockMapSize is dropped rather than recomputed. The appended block map still
 * describes the old header bytes, and rather than regenerate it — which would
 * pull app-builder into this step for a differential-download optimisation — we
 * let the updater fall back to a full download, which it verifies against the
 * sha512 we just wrote. AppImage updates were full downloads in practice
 * anyway. Correctness over a few saved megabytes, in the one area we have been
 * burned.
 *
 * The caller hands us a runtime file it has already downloaded and checksum-
 * verified, so this script does no network and runs anywhere with Node. The
 * workflow then re-uploads the rewritten AppImages and ymls over the draft
 * release, which no one can see until a later job publishes it.
 *
 * Usage:
 *   node relink-appimage-fuse.mjs --runtime <static-runtime> --dir <releaseDir>
 *
 * Run from packages/client (js-yaml resolves from its node_modules). Exits
 * non-zero, and changes nothing, if it finds no Linux AppImage to relink — a
 * silent no-op here would ship the broken file.
 */

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

// electron-builder's Linux AppImages, both the full build and the -slim one.
// Only x86_64 is built (the release matrix has a single Linux leg), so a plain
// suffix match is enough; anything else in here (deb, snap) is left untouched.
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

// The offset of the squashfs payload is the size of the current runtime. Ask
// the AppImage itself rather than parsing the ELF; --appimage-offset runs the
// bundled runtime's own reporting path and needs no FUSE.
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

// Every Linux updater manifest in the dir. Their names vary by channel
// (latest-linux.yml, beta-linux.yml) and by variant (slim-linux.yml), so an
// AppImage is matched to its manifest by what the manifest points at, not by a
// name we guessed. A beta build writes beta-linux.yml, and guessing "latest"
// would leave it unpatched while shipping an AppImage with a new sha512.
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
