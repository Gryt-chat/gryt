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

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { DEVICES, resolveFrame } from "./devices.mjs";
import { measureAperture } from "./measure-frame.mjs";
import { KINDS } from "./panels.mjs";
import { fit, loadFont } from "./text.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/* ─────────────────────────────────────────────────────────── the device ── */

const apertureCache = new Map();

async function apertureFor(deviceId) {
  if (!apertureCache.has(deviceId)) {
    const device = DEVICES[deviceId];
    const framePath = resolveFrame(deviceId);
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
  const frame = sharp(framePath);
  const { width, height } = await frame.metadata();

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

  layers.push({ input: await frame.png().toBuffer(), left: 0, top: 0 });

  return {
    buffer: await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(layers)
      .png()
      .toBuffer(),
    width,
    height,
  };
}

/* ────────────────────────────────────────────────────────────── the panel ── */

function groundSvg(theme, width, height) {
  if (theme.ground.type === "gradient") {
    const { from, to, angle = 160 } = theme.ground;
    // Angle in degrees, 0 = left to right, measured clockwise.
    const rad = (angle * Math.PI) / 180;
    const x1 = (50 - Math.cos(rad) * 50).toFixed(2);
    const y1 = (50 - Math.sin(rad) * 50).toFixed(2);
    const x2 = (50 + Math.cos(rad) * 50).toFixed(2);
    const y2 = (50 + Math.sin(rad) * 50).toFixed(2);
    return `<defs><linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/>`;
  }
  return `<rect width="${width}" height="${height}" fill="${theme.ground.color}"/>`;
}

/* ─────────────────────────────────────────────────────────────── the set ── */

/**
 * Render one set for one device.
 *
 * Panels are laid out by kind (see `panels.mjs`), but the three `device` ones
 * share a headline size and a device y so they read as a run. Sizing each on
 * its own gives short headlines bigger type and shifts the phone down a line
 * between panels, which is what makes a set look assembled.
 *
 * The statement panel is deliberately outside that agreement — it places its
 * own phone, lower, because it is the opening and not one of the three.
 */
export async function renderSet({ set, deviceId, outDir }) {
  const device = DEVICES[deviceId];
  const { width: W, height: H } = device.output;
  const theme = set.theme;
  const font = await loadFont();

  const deviceKinds = set.panels.filter((p) => (p.kind ?? "device") === "device");

  /** The largest size every device panel's headline fits at. */
  const headlineSize = deviceKinds.length
    ? Math.min(
        ...deviceKinds.map(
          (panel) =>
            fit(panel.headline, {
              font,
              weight: theme.headline.weight,
              tracking: theme.headline.tracking,
              maxWidth: W - theme.headline.inset * 2,
              maxLines: theme.headline.maxLines,
              sizes: theme.headline.sizes,
            }).size,
        ),
      )
    : theme.headline.sizes[0];

  // Laid out once to find the run's device y, then again to draw.
  let runBottom = 0;
  for (const panel of deviceKinds) {
    const { bottom } = KINDS.device({ panel, theme, font, W, H, headlineSize });
    runBottom = Math.max(runBottom, bottom);
  }
  const runDeviceTop = Math.round(runBottom + theme.device.gap);

  /* Emptied first. Renaming or dropping a panel otherwise leaves the old file
     behind, and `out/` is what gets uploaded — a stale panel from two edits ago
     is the kind of mistake nobody catches until it is live. */
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const written = [];

  for (const [i, panel] of set.panels.entries()) {
    const kind = panel.kind ?? "device";
    const laid = await KINDS[kind]({ panel, theme, font, W, H, headlineSize });

    const ground = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${groundSvg(theme, W, H)}${laid.svg}</svg>`;
    const layers = laid.tiles ? [...laid.tiles] : [];

    const deviceTop = kind === "device" ? runDeviceTop : laid.deviceTop;
    if (deviceTop !== null && deviceTop !== undefined) {
      const framed = await composeDevice(
        deviceId,
        panel.screenshot ? join(here, panel.screenshot) : null,
      );
      const ratio = panel.deviceWidthRatio ?? theme.device.widthRatio;
      const w = Math.round(W * ratio);
      const h = Math.round(framed.height * (w / framed.width));
      const phone = await sharp(framed.buffer).resize(w, h, { fit: "fill" }).png().toBuffer();
      /* Cropped by the composite rather than by a resize: the device is taller
         than the room under the headline, and running off the bottom edge is
         the look. sharp clips at the canvas edge, so the overflow is free. */
      layers.push({ input: phone, left: Math.round((W - w) / 2), top: deviceTop });
    }

    const panelBuffer = await sharp(Buffer.from(ground))
      .composite(layers)
      /* Flattened deliberately. Apple refuses a screenshot with an alpha
         channel, and a PNG that carries one uploads and then fails validation
         with a message that does not say why. */
      .flatten({
        background: theme.ground.type === "gradient" ? theme.ground.from : theme.ground.color,
      })
      .png()
      .toBuffer();

    const name = `${String(i + 1).padStart(2, "0")}-${panel.slug}.png`;
    const file = join(outDir, name);
    await writeFile(file, panelBuffer);
    written.push({ file, width: W, height: H, kind });
  }

  return written;
}

/* ────────────────────────────────────────────────────────────────── cli ── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const [configPath = "./shots.config.mjs", ...only] = process.argv.slice(2);
  const { sets } = await import(configPath.startsWith(".") ? join(here, configPath) : configPath);

  for (const set of sets) {
    for (const deviceId of set.devices) {
      if (only.length && !only.includes(deviceId)) continue;
      const outDir = join(here, "out", set.slug, deviceId);
      console.log(`${set.slug} → ${deviceId} (${DEVICES[deviceId].label})`);
      try {
        const written = await renderSet({ set, deviceId, outDir });
        for (const w of written) {
          console.log(`  ${basename(w.file)}  ${w.width}x${w.height}  ${w.kind}`);
        }
      } catch (err) {
        console.error(`  skipped: ${err.message}`);
      }
    }
  }
}
