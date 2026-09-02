/* eslint-env node */

/**
 * Where the screen is inside a device frame PNG.
 *
 * Every panel in every template is a screenshot dropped into a frame, so this
 * one rectangle decides whether the whole set is right. Measured from the
 * alpha channel rather than written down, because a frame asset gets replaced
 * when the hardware does and a stale offset produces images that look fine
 * until somebody holds them next to a real phone.
 *
 * **A whole-image transparent bounding box is the wrong answer.** Outside the
 * rounded body is transparent too, so that returns the full canvas. Walking
 * the centre column also lies: on an iPhone the Dynamic Island is opaque and
 * stops the walk about a fifth of the way down.
 *
 * What works, and what this does:
 *
 *   - walk the centre *row* inward for the left and right edges,
 *   - walk the centre *column* upward from the bottom for the bottom edge,
 *   - walk it downward from the top for the top edge, then check the two
 *     against the aspect ratio the device is supposed to have.
 *
 * The last check is what catches the Dynamic Island: if the top edge it finds
 * disagrees with `bottom - expectedHeight + 1`, the walk hit opaque pixels
 * inside the screen and the derived value is the one to trust.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import sharp from "sharp";

const ALPHA_THRESHOLD = 8; // anything below this is transparent enough to be screen

export async function measureAperture(framePath, expected) {
  const image = sharp(framePath);
  const { width, height, channels } = await image.metadata();
  if (channels < 4) {
    throw new Error(`${basename(framePath)} has no alpha channel, so the screen cannot be found`);
  }

  const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * width + x) * 4 + 3];

  const midY = Math.floor(height / 2);
  const midX = Math.floor(width / 2);

  let left = 0;
  while (left < width && alphaAt(left, midY) < ALPHA_THRESHOLD) left++;
  while (left < width && alphaAt(left, midY) >= ALPHA_THRESHOLD) left++;

  let right = width - 1;
  while (right >= 0 && alphaAt(right, midY) < ALPHA_THRESHOLD) right--;
  while (right >= 0 && alphaAt(right, midY) >= ALPHA_THRESHOLD) right--;

  let bottom = height - 1;
  while (bottom >= 0 && alphaAt(midX, bottom) < ALPHA_THRESHOLD) bottom--;
  while (bottom >= 0 && alphaAt(midX, bottom) >= ALPHA_THRESHOLD) bottom--;

  let top = 0;
  while (top < height && alphaAt(midX, top) < ALPHA_THRESHOLD) top++;
  while (top < height && alphaAt(midX, top) >= ALPHA_THRESHOLD) top++;

  const measured = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };

  if (!expected) return { ...measured, source: "measured", warnings: [] };

  /* The derived top, for a frame whose notch or island is opaque. `expected`
     is the device's real screen size in pixels, which is also exactly what the
     simulator captures — so when the two disagree the walk is what is wrong. */
  const derivedTop = bottom - expected.height + 1;
  const warnings = [];

  if (measured.width !== expected.width) {
    warnings.push(
      `width measured ${measured.width}, expected ${expected.width} — the frame may not be for this device`,
    );
  }
  if (measured.y !== derivedTop) {
    warnings.push(
      `top walk stopped at y=${measured.y}, deriving ${derivedTop} from the bottom instead (opaque pixels inside the screen, usually the Dynamic Island)`,
    );
  }

  return {
    x: left,
    y: derivedTop,
    width: expected.width,
    height: expected.height,
    source: measured.y === derivedTop ? "measured" : "derived",
    measured,
    warnings,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [framePath, w, h] = process.argv.slice(2);
  if (!framePath) {
    console.error("usage: node measure-frame.mjs <frame.png> [screenWidth screenHeight]");
    process.exit(1);
  }
  readFileSync(framePath); // fail loudly and early on a bad path
  const expected = w && h ? { width: Number(w), height: Number(h) } : undefined;
  const result = await measureAperture(framePath, expected);
  for (const warning of result.warnings ?? []) console.warn(`warning: ${warning}`);
  console.log(JSON.stringify(result, null, 2));
}
