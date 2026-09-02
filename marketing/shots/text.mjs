/* eslint-env node */

/**
 * Text as glyph outlines, because librsvg cannot be trusted to find a font.
 *
 * Sharp rasterises SVG through librsvg, which resolves `font-family` against
 * whatever fontconfig happens to know about on the machine it runs on. That is
 * a different answer on a laptop and in CI, and when it goes wrong it does not
 * fail — it silently substitutes something else and the image ships in the
 * wrong typeface.
 *
 * So nothing here emits a `<text>` element. Every string is laid out by
 * fontkit and written as `<path>` outlines, which render identically anywhere.
 * `packages/site/scripts/generate-og-image.mjs` does the same thing for the
 * share cards and is where this came from.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as fontkit from "fontkit";
import wawoff2 from "wawoff2";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Vendored rather than read out of `packages/site`.
 *
 * That is a submodule, so reading across would make this tool fail on a
 * checkout where the site is not initialised — for a file that changes about
 * once a year. Atkinson Hyperlegible is OFL, so a copy is fine.
 */
const FONT_FILE = join(here, "fonts", "AtkinsonHyperlegibleNextVF-Variable.woff2");

let cached = null;

export async function loadFont() {
  if (!cached) {
    const ttf = Buffer.from(await wawoff2.decompress(readFileSync(FONT_FILE)));
    cached = fontkit.create(ttf);
  }
  return cached;
}

/** Where the baseline sits inside a line box, per the CSS half-leading model. */
export function baselineOffset(font, size, lineHeight) {
  const { ascent, descent, unitsPerEm } = font;
  const contentHeight = ((ascent - descent) / unitsPerEm) * size;
  return (lineHeight - contentHeight) / 2 + (ascent / unitsPerEm) * size;
}

export function measure(text, { font, weight, size, tracking = 0 }) {
  const run = font.getVariation({ wght: weight }).layout(text);
  const scale = size / font.unitsPerEm;
  return run.advanceWidth * scale + tracking * Math.max(0, run.glyphs.length - 1);
}

/**
 * One string as glyph outlines. `y` is the baseline, not the top of the line.
 * The inner scale flips Y because font outlines are drawn with Y pointing up.
 */
export function glyphs(text, { font, weight, size, tracking = 0, x, y, fill, anchor = "start" }) {
  const run = font.getVariation({ wght: weight }).layout(text);
  const scale = size / font.unitsPerEm;
  const trackUnits = tracking / scale;

  let cursor = 0;
  const parts = [];
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i];
    const d = glyph.path.toSVG();
    if (d) {
      const dx = (cursor + (pos.xOffset || 0)).toFixed(1);
      const dy = (pos.yOffset || 0).toFixed(1);
      parts.push(`<path transform="translate(${dx},${dy})" d="${d}"/>`);
    }
    cursor += pos.xAdvance + trackUnits;
  });

  const width = run.advanceWidth * scale + tracking * Math.max(0, run.glyphs.length - 1);
  const left = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
  return `<g transform="translate(${left.toFixed(1)},${y.toFixed(1)}) scale(${scale},${-scale})" fill="${fill}">${parts.join("")}</g>`;
}

/** Greedy wrap. Words longer than the line get their own line rather than a break. */
export function wrap(text, maxWidth, opts) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate, opts) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The largest size from `sizes` at which the text fits in `maxLines`.
 *
 * Headlines are written by a person and vary in length, so a fixed size either
 * overflows the panel or leaves the short ones looking timid. Falls back to the
 * smallest size given, which can still overflow — the caller is told by getting
 * more lines back than it asked for.
 */
export function fit(text, { maxWidth, maxLines, sizes, ...opts }) {
  for (const size of sizes) {
    const lines = wrap(text, maxWidth, { ...opts, size });
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrap(text, maxWidth, { ...opts, size }) };
}
