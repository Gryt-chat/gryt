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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { DEVICES, resolveFrame } from "./devices.mjs";
import { measureAperture } from "./measure-frame.mjs";
import { baselineOffset, fit, glyphs, loadFont } from "./text.mjs";

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

/**
 * The text block, and how far down the panel it ends.
 *
 * Returns the bottom edge so the device can be placed under it rather than at
 * a hardcoded offset — a two-line headline and a three-line one must not push
 * the phone to different heights across a set, so the caller uses the tallest.
 */
function textSvg({ panel, theme, font, width, top, size: forcedSize }) {
  const out = [];
  let y = top;

  if (panel.icon) {
    const size = theme.icon.size;
    const x = (width - size) / 2;
    /* Filled, not stroked. Phosphor's regular weight is a filled outline on a
       256 grid — stroking it draws the outline of the outline. */
    out.push(
      `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(size / 256).toFixed(4)})"
          fill="${theme.icon.color}">${panel.icon}</g>`,
    );
    y += size + theme.icon.gap;
  }

  const opts = {
    font,
    weight: theme.headline.weight,
    tracking: theme.headline.tracking ?? 0,
  };
  const { size, lines } = fit(panel.headline, {
    ...opts,
    maxWidth: width - theme.headline.inset * 2,
    maxLines: theme.headline.maxLines,
    /* One size for the whole set when the caller has worked it out. Sizing
       each panel on its own gives the short headlines a bigger type than the
       long ones, which reads as six posters rather than one set. */
    sizes: forcedSize ? [forcedSize] : theme.headline.sizes,
  });

  const lineHeight = size * theme.headline.lineHeight;
  const base = baselineOffset(font, size, lineHeight);

  for (const line of lines) {
    out.push(
      glyphs(line, {
        ...opts,
        size,
        x: width / 2,
        y: y + base,
        fill: theme.headline.color,
        anchor: "middle",
      }),
    );
    y += lineHeight;
  }

  return { svg: out.join(""), bottom: y };
}

/* ─────────────────────────────────────────────────────────────── the set ── */

/**
 * Render one set for one device.
 *
 * The device is placed at the same y across every panel, derived from the
 * tallest text block in the set. A phone that shifts down by one line's height
 * between panel two and panel three is the thing that makes a set look
 * assembled rather than designed.
 */
export async function renderSet({ set, deviceId, outDir }) {
  const device = DEVICES[deviceId];
  const { width: W, height: H } = device.output;
  const theme = set.theme;
  const font = await loadFont();

  const framed = await Promise.all(
    set.panels.map((panel) =>
      composeDevice(deviceId, panel.screenshot ? join(here, panel.screenshot) : null),
    ),
  );

  const deviceWidth = Math.round(W * theme.device.widthRatio);
  const scale = deviceWidth / framed[0].width;
  const deviceHeight = Math.round(framed[0].height * scale);

  /**
   * The largest size every headline in the set fits at, and the tallest text
   * block once they are all at it.
   *
   * Two passes because they depend on each other in that order: the size is
   * the smallest of what each panel could take on its own, and only then is
   * it worth asking how far down the block reaches.
   */
  const headlineSize = Math.min(
    ...set.panels.map(
      (panel) =>
        fit(panel.headline, {
          font,
          weight: theme.headline.weight,
          tracking: theme.headline.tracking ?? 0,
          maxWidth: W - theme.headline.inset * 2,
          maxLines: theme.headline.maxLines,
          sizes: theme.headline.sizes,
        }).size,
    ),
  );

  let textBottom = 0;
  for (const panel of set.panels) {
    const { bottom } = textSvg({
      panel, theme, font, width: W, top: theme.text.top, size: headlineSize,
    });
    textBottom = Math.max(textBottom, bottom);
  }
  const deviceTop = Math.round(textBottom + theme.device.gap);

  await mkdir(outDir, { recursive: true });
  const written = [];

  for (const [i, panel] of set.panels.entries()) {
    const { svg: text } = textSvg({
      panel, theme, font, width: W, top: theme.text.top, size: headlineSize,
    });
    const ground = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${groundSvg(theme, W, H)}${text}</svg>`;

    const phone = await sharp(framed[i].buffer)
      .resize(deviceWidth, deviceHeight, { fit: "fill" })
      .png()
      .toBuffer();

    /* Cropped by the composite rather than by a resize: the device is taller
       than the room under the headline, and running off the bottom edge is the
       look in all three templates. sharp clips a composite at the canvas edge,
       so the overflow costs nothing. */
    const panelBuffer = await sharp(Buffer.from(ground))
      .composite([{ input: phone, left: Math.round((W - deviceWidth) / 2), top: deviceTop }])
      /* Flattened deliberately. Apple refuses a screenshot with an alpha
         channel, and a PNG that carries one uploads and then fails validation
         with a message that does not say why. */
      .flatten({ background: theme.ground.type === "gradient" ? theme.ground.from : theme.ground.color })
      .png()
      .toBuffer();

    const name = `${String(i + 1).padStart(2, "0")}-${panel.slug}.png`;
    const file = join(outDir, name);
    await writeFile(file, panelBuffer);
    written.push({ file, width: W, height: H });
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
          console.log(`  ${basename(w.file)}  ${w.width}x${w.height}`);
        }
      } catch (err) {
        console.error(`  skipped: ${err.message}`);
      }
    }
  }
}
