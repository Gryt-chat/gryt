/* eslint-env node */

/**
 * Store screenshots, composed from a real capture and a real device frame.
 *
 * **One wide canvas, sliced into panels.** Panels are rendered into a strip
 * `panels.length * output.width` across and then cut, rather than each panel
 * being its own image. Two of the three templates Sivert supplied run a phone
 * across two or three panels so the set reads as one picture when the carousel
 * is scrolled, and that is not expressible panel by panel. A set whose panels
 * are all independent — the third template, and the default here — comes out of
 * the same code with nothing spanning.
 *
 * **The screenshot goes under the frame, never over it.** The bezel is opaque
 * and covers the capture's square corners, so nothing needs rounding and no
 * mask can be slightly wrong.
 *
 * **Nothing is resampled that does not have to be.** A capture is dropped into
 * the aperture at 1:1 and the framed device is scaled once, as a unit. Scaling
 * the screenshot and the frame separately is how a bezel ends up half a pixel
 * off its own screen.
 */

import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { owlAvatarSvg } from "@gryt/owl";
import sharp from "sharp";

import { DEVICES, resolveFrame } from "./devices.mjs";
import { measureAperture } from "./measure-frame.mjs";
import { renderStrip } from "./strip.mjs";
import { loadFont } from "./text.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/* ─────────────────────────────────────────────────────────── the device ── */

const apertureCache = new Map();

async function apertureFor(deviceId) {
  if (!apertureCache.has(deviceId)) {
    const device = DEVICES[deviceId];
    const framePath = resolveFrame(deviceId);

    /* Frameless: the screenshot is the whole device, so the aperture is its
       own bounds and there is nothing to measure. */
    if (!framePath) {
      apertureCache.set(deviceId, {
        framePath: null,
        aperture: { x: 0, y: 0, ...device.capture, warnings: [] },
      });
      return apertureCache.get(deviceId);
    }

    const aperture = await measureAperture(framePath, device.capture);
    for (const warning of aperture.warnings ?? []) {
      console.warn(`  frame ${basename(framePath)}: ${warning}`);
    }
    apertureCache.set(deviceId, { framePath, aperture });
  }
  return apertureCache.get(deviceId);
}

/**
 * One framed device, at native frame size, as a PNG with alpha.
 *
 * `screenshotPath` may be null, which gives an empty frame — the outline
 * panels in the second template, and what you get before any captures exist.
 */
export async function composeDevice(deviceId, screenshotPath) {
  const { framePath, aperture } = await apertureFor(deviceId);
  const device = DEVICES[deviceId];

  const { width, height } = framePath
    ? await sharp(framePath).metadata()
    : device.capture;

  const layers = [];

  /* A missing capture renders the empty frame rather than failing. The layout
     is worth seeing before any screenshots exist, and it is the honest state
     to leave a half-built set in — an empty phone is obviously not finished,
     where a stale capture from three releases ago is not. */
  if (screenshotPath && !existsSync(screenshotPath)) {
    console.warn(`  no capture at ${basename(screenshotPath)} — rendering an empty frame`);
  }

  if (screenshotPath && existsSync(screenshotPath)) {
    const shot = sharp(await readFile(screenshotPath));
    const meta = await shot.metadata();

    /* Resized only when the capture is not already the aperture. A simulator
       running the device this frame is for produces an exact match, and the
       common path should not touch the pixels at all. */
    const needsResize = meta.width !== aperture.width || meta.height !== aperture.height;
    if (needsResize) {
      console.warn(
        `  ${basename(screenshotPath)} is ${meta.width}x${meta.height}, aperture is ` +
          `${aperture.width}x${aperture.height} — resampling. Capture on ${DEVICES[deviceId].simulator ?? "the right device"} to avoid this.`,
      );
    }

    const body = needsResize
      ? await shot.resize(aperture.width, aperture.height, { fit: "cover" }).png().toBuffer()
      : await shot.png().toBuffer();

    layers.push({ input: body, left: aperture.x, top: aperture.y });
  }

  if (framePath) {
    layers.push({ input: await sharp(framePath).png().toBuffer(), left: 0, top: 0 });
  }

  let composed = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .png()
    .toBuffer();

  /* Frameless devices get their corners rounded here rather than by the caller.
     A square-cornered screenshot on a coloured ground is the tell that nobody
     thought about it, and the radius belongs with the device rather than with
     the layout. */
  if (!framePath && device.cornerRadius) {
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${device.cornerRadius}" fill="#fff"/></svg>`,
    );
    composed = await sharp(composed)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  return {
    buffer: composed,
    width,
    height,
  };
}

/* ─────────────────────────────────────────────────────────────── the owls ── */

/**
 * The owl wall, as composite layers in strip coordinates.
 *
 * Rasterised one at a time rather than inlined into the strip's SVG: an owl
 * carries its own full-bleed background rect, and nesting twenty of those in
 * one document leaves the corner rounding to librsvg.
 */
async function owlTiles({ owls, theme, W, H }) {
  if (!owls) return [];

  const cell = Math.round(owls.cell * W);
  const left0 = Math.round(owls.x * W);
  const top0 = Math.round(owls.y * H);
  const wanted = owls.rows * owls.columns;

  if (owls.seeds.length < wanted) {
    console.warn(
      `  owl wall has ${owls.seeds.length} seeds for ${wanted} tiles — they will repeat. Add ${wanted - owls.seeds.length} more.`,
    );
  }

  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}"><rect width="${cell}" height="${cell}" rx="${theme.owlTile.radius}" fill="#fff"/></svg>`,
  );

  const tiles = [];
  for (let i = 0; i < wanted; i++) {
    const flat = await sharp(Buffer.from(owlAvatarSvg(owls.seeds[i % owls.seeds.length], {})))
      .resize(cell, cell)
      .png()
      .toBuffer();
    tiles.push({
      input: await sharp(flat).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(),
      left: left0 + (i % owls.columns) * (cell + owls.gap),
      top: top0 + Math.floor(i / owls.columns) * (cell + owls.gap),
    });
  }
  return tiles;
}

/* ─────────────────────────────────────────────────────────────── the set ── */

export async function renderSet({ set, deviceId, outDir }) {
  const device = DEVICES[deviceId];
  const { width: W, height: H } = device.output;
  const font = await loadFont();

  /* Composed once per distinct screenshot. Three of the five placements in a
     set reuse a capture across devices, and framing is the expensive step. */
  const cache = new Map();
  /**
   * A capture is named by slug, and the path is per device.
   *
   * `captures/<device>/<slug>.png`. The config names screens rather than
   * files, so one set renders for the iPhone, the iPad and Android without
   * three copies of the layout — and an iPad panel can never accidentally
   * carry a phone capture, which is the mistake the earlier hardcoded paths
   * made silently and at the wrong resolution.
   */
  const framedFor = async (slug) => {
    const key = slug ?? "";
    if (!cache.has(key)) {
      const path = slug ? join(here, "captures", deviceId, `${slug}.png`) : null;
      cache.set(key, await composeDevice(deviceId, path));
    }
    return cache.get(key);
  };

  /**
   * Placements for this device, where the set gives them.
   *
   * A tablet panel is 0.75 wide-to-tall and a phone panel 0.46, so the same
   * fractional placements put a phone-sized device in the middle of a much
   * wider field with the text stranded above it. The type scales on its own
   * (see `scaleTheme`); where a subject sits does not, and pretending it does
   * is how a tablet listing ends up looking like the phone one stretched.
   */
  const perDevice = set.perDevice?.[deviceId] ?? {};
  const resolved = { ...set, ...perDevice };

  const { cuts, strip } = await renderStrip({
    set: resolved,
    W,
    H,
    font,
    framedFor,
    owlTiles: await owlTiles({ owls: resolved.owls, theme: resolved.theme, W, H }),
  });

  /* Emptied first. Renaming or dropping a panel otherwise leaves the old file
     behind, and `panels/` is what gets uploaded — a stale panel from two edits ago
     is the kind of mistake nobody catches until it is live. */
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const written = [];
  for (const [i, buffer] of cuts.entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-${resolved.slugs[i] ?? `panel-${i + 1}`}.png`;
    const file = join(outDir, name);
    await writeFile(file, buffer);
    written.push({ file, width: W, height: H });
  }

  /* The uncut strip, for looking at. Not uploaded anywhere — it is how you see
     whether the phones actually line up across the cuts. */
  await writeFile(join(outDir, "_strip.png"), strip);

  return written;
}

/* ────────────────────────────────────────────────────────────────── cli ── */

/**
 * Whether this file is the one node was asked to run.
 *
 * `import.meta.url === "file://" + process.argv[1]` is the usual shape and it
 * is wrong on a path with a symlink in it: `import.meta.url` is resolved and
 * argv is not, so on macOS anything under /tmp compares false and the CLI
 * silently does nothing. Resolving both is the fix.
 */
function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  const [configPath = "./shots.config.mjs", ...only] = process.argv.slice(2);
  const { sets } = await import(configPath.startsWith(".") ? join(here, configPath) : configPath);

  for (const set of sets) {
    for (const deviceId of set.devices) {
      if (only.length && !only.includes(deviceId)) continue;
      const outDir = join(here, "panels", set.slug, deviceId);
      console.log(`${set.slug} → ${deviceId} (${DEVICES[deviceId].label})`);
      try {
        const written = await renderSet({ set, deviceId, outDir });
        for (const w of written) console.log(`  ${basename(w.file)}  ${w.width}x${w.height}`);
      } catch (err) {
        console.error(`  skipped: ${err.message}`);
      }
    }
  }
}
