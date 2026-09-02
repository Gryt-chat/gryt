/* eslint-env node */

/**
 * One wide canvas, sliced into panels.
 *
 * The reference set Sivert picked works because the phones are large, tilted,
 * and **cross the panel edges** — a device leaves one panel and arrives in the
 * next, so scrolling the carousel reads as panning across one picture rather
 * than flicking through six cards. That is not expressible panel by panel,
 * which is why this composes at `panels x width` and cuts at the end.
 *
 * The App Store carousel shows one panel with a sliver of the next, so a device
 * cut by a boundary is seen half-and-half rather than broken in two. It is
 * still the risk of the format: **every panel has to survive being looked at
 * alone**, because that is how the first one is seen. The rule that keeps it
 * honest is that no panel may be only the middle of a phone — each carries
 * either its own text or a whole subject.
 *
 * Coordinates are strip coordinates. `x: 1.5` means one and a half panels
 * across, so a placement reads as where it sits in the sequence rather than as
 * a pixel offset that has to be recomputed when the device size changes.
 */

import sharp from "sharp";

import { baselineOffset, fit, glyphs, measure, wrap } from "./text.mjs";

/** Strip units to pixels. `x` is in panels, `y` is a fraction of panel height. */
const px = (value, span) => Math.round(value * span);

/**
 * Refuse a block of text that crosses a panel edge.
 *
 * A phone crossing a boundary is the whole point of a strip. Text crossing one
 * is a headline chopped mid-word in the cut, and it is invisible while you are
 * looking at the uncut strip — which is exactly when the layout gets adjusted.
 * So it throws rather than warns: the strip renders fine and every panel is
 * wrong, which is the sort of thing that ships.
 */
function assertWithinPanel(spec, widthUnits, label) {
  const panel = Math.floor(spec.x);
  const end = spec.x + widthUnits;
  if (end > panel + 1 + 1e-9) {
    throw new Error(
      `${label} starts at x=${spec.x} and runs ${widthUnits.toFixed(2)} panels to ${end.toFixed(2)}, ` +
        `crossing the edge of panel ${panel + 1} — it would be cut mid-word. ` +
        `Reduce maxWidth to ${(panel + 1 - spec.x).toFixed(2)} or move it left.`,
    );
  }
}

/**
 * A framed device, tilted and scaled, plus where its top-left corner lands.
 *
 * Rotation happens once on the composed device — frame and screenshot
 * together — so the bezel can never drift from its own screen. sharp grows the
 * canvas to fit the rotation, so the placement is computed from the *rotated*
 * size and the caller positions by centre rather than by corner.
 */
async function placeDevice({ framed, widthPx, angle, centreX, centreY }) {
  const height = Math.round(framed.height * (widthPx / framed.width));

  let buffer = await sharp(framed.buffer).resize(widthPx, height, { fit: "fill" }).png().toBuffer();

  if (angle) {
    buffer = await sharp(buffer)
      .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }

  const meta = await sharp(buffer).metadata();
  return {
    input: buffer,
    left: Math.round(centreX - meta.width / 2),
    top: Math.round(centreY - meta.height / 2),
  };
}

/**
 * A text block in strip coordinates.
 *
 * Left-aligned by default and placed per block rather than centred on a shared
 * baseline: a set where every headline sits at the same y in the same size is
 * the symmetric arrangement this is trying to get away from.
 */
function textBlock({ font, theme, spec, W, H }) {
  const style = theme.text[spec.style ?? "headline"];
  const x = px(spec.x, W);
  const y = px(spec.y, H);
  const widthUnits = spec.maxWidth ?? (W - style.inset * 2) / W;
  assertWithinPanel(spec, widthUnits, `text "${spec.text.slice(0, 32)}…"`);
  const maxWidth = px(widthUnits, W);

  const out = [];
  let cursor = y;

  if (spec.eyebrow) {
    const size = theme.text.eyebrow.size;
    /* Dark on the accent band. The eyebrow keeps its own colour token rather
       than inheriting the headline's, and the light one vanishes on accent. */
    const eyebrowFill =
      spec.style === "onBand" ? theme.text.eyebrow.onBandColor : theme.text.eyebrow.color;
    out.push(
      glyphs(spec.eyebrow.toUpperCase(), {
        font,
        weight: theme.text.eyebrow.weight,
        size,
        tracking: theme.text.eyebrow.tracking,
        x,
        y: cursor + baselineOffset(font, size, size * 1.2),
        fill: eyebrowFill,
      }),
    );
    cursor += size * 1.2 + theme.text.eyebrow.gap;
  }

  const { size, lines } = fit(spec.text, {
    font,
    weight: style.weight,
    tracking: style.tracking,
    maxWidth,
    maxLines: style.maxLines,
    sizes: style.sizes,
  });

  const lh = size * style.lineHeight;
  const base = baselineOffset(font, size, lh);
  for (const line of lines) {
    out.push(
      glyphs(line, { font, weight: style.weight, size, tracking: style.tracking, x, y: cursor + base, fill: style.color }),
    );
    cursor += lh;
  }

  if (spec.sub) {
    const s = theme.text.sub;
    const subLines = wrap(spec.sub, maxWidth, { font, weight: s.weight, size: s.size });
    const subLh = s.size * s.lineHeight;
    const subBase = baselineOffset(font, s.size, subLh);
    cursor += s.gap;
    for (const line of subLines) {
      out.push(glyphs(line, { font, weight: s.weight, size: s.size, x, y: cursor + subBase, fill: s.color }));
      cursor += subLh;
    }
  }

  return out.join("");
}

/** The command chip, in strip coordinates. */
function commandBlock({ font, theme, spec, W, H }) {
  const c = theme.command;
  const x = px(spec.x, W);
  const y = px(spec.y, H);
  const promptW = measure(c.prompt, { font, weight: 500, size: c.size });
  const textW = measure(spec.command, { font, weight: 600, size: c.size });
  const boxW = Math.round(promptW + textW + c.pad * 2);
  assertWithinPanel(spec, boxW / W, `command "${spec.command}"`);
  const base = baselineOffset(font, c.size, c.size * 1.2);
  const textY = y + c.height / 2 - (c.size * 1.2) / 2 + base;

  return (
    `<rect x="${x}" y="${y}" width="${boxW}" height="${c.height}" rx="${c.radius}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>` +
    glyphs(c.prompt, { font, weight: 500, size: c.size, x: x + c.pad, y: textY, fill: c.promptColor }) +
    glyphs(spec.command, { font, weight: 600, size: c.size, x: x + c.pad + promptW, y: textY, fill: c.color })
  );
}

/**
 * Compose the strip and cut it.
 *
 * Everything is placed against the full width and the slicing is the last step,
 * so a device or a word that straddles a boundary needs no special handling —
 * it is simply present in both cuts.
 */
/**
 * The reference panel width the theme's pixel values were chosen against.
 *
 * Everything in the theme that is a length — type sizes, insets, the command
 * chip — is in pixels, and a panel is 1320 across on an iPhone and 2064 on an
 * iPad. Left alone, the same headline is a third smaller on the bigger device
 * and the set stops looking like one design. Fractions could have avoided this,
 * but a font size written as 0.079 of a panel is unreadable to whoever tunes it
 * next.
 */
const REFERENCE_WIDTH = 1320;

/** Every length in the theme, scaled to this device's panel. */
function scaleTheme(theme, k) {
  if (k === 1) return theme;
  const scale = (v) => (typeof v === "number" ? Math.round(v * k * 100) / 100 : v);
  const lengths = new Set([
    "size", "tracking", "inset", "gap", "height", "pad", "radius", "lineHeight",
  ]);

  const walk = (node) => {
    if (Array.isArray(node)) return node.map((v) => (typeof v === "number" ? scale(v) : walk(v)));
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "lineHeight") out[key] = value; // a ratio, not a length
      else if (key === "sizes" && Array.isArray(value)) out[key] = value.map(scale);
      else if (lengths.has(key) && typeof value === "number") out[key] = scale(value);
      else out[key] = typeof value === "object" ? walk(value) : value;
    }
    return out;
  };
  return walk(theme);
}

export async function renderStrip({ set, W, H, font, framedFor, owlTiles }) {
  const theme = scaleTheme(set.theme, W / REFERENCE_WIDTH);
  /* The number of cuts, from the filenames rather than a `panels` array. A
     strip has no per-panel objects — that is the point of it — so the slug list
     is the only thing that says how many panels there are. */
  const count = set.slugs.length;
  const stripW = W * count;

  const svg = [];
  const layers = [];

  if (theme.ground.type === "gradient") {
    const { from, to } = theme.ground;
    svg.push(
      `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="60%">` +
        `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs>` +
        `<rect width="${stripW}" height="${H}" fill="url(#g)"/>`,
    );
  } else {
    svg.push(`<rect width="${stripW}" height="${H}" fill="${theme.ground.color}"/>`);
  }

  /* Bands first, under everything. A block of a second colour behind two of the
     six panels is what stops a flat ground reading as flat across a strip this
     wide — and because it is placed in strip coordinates it can end mid-panel,
     which a per-panel renderer cannot do. */
  for (const band of set.bands ?? []) {
    svg.push(
      `<rect x="${px(band.x, W)}" y="${px(band.y ?? 0, H)}" width="${px(band.width, W)}" height="${px(band.height ?? 1, H)}" fill="${band.fill}"/>`,
    );
  }

  for (const spec of set.text ?? []) {
    svg.push(spec.command ? commandBlock({ font, theme, spec, W, H }) : textBlock({ font, theme, spec, W, H }));
  }

  for (const tile of owlTiles ?? []) layers.push(tile);

  /* `phones`, not `devices`. `set.devices` is the list of store targets this
     set renders for — iPhone, iPad, Android — and reusing the word for the
     placements meant the strip tried to place three strings. */
  for (const spec of set.phones ?? []) {
    const framed = await framedFor(spec.screenshot ?? null);
    layers.push(
      await placeDevice({
        framed,
        widthPx: px(spec.width, W),
        angle: spec.angle ?? 0,
        centreX: px(spec.x, W),
        centreY: px(spec.y, H),
      }),
    );
  }

  const strip = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${stripW}" height="${H}" viewBox="0 0 ${stripW} ${H}">${svg.join("")}</svg>`,
    ),
  )
    .composite(layers)
    .png()
    .toBuffer();

  const cuts = [];
  for (let i = 0; i < count; i++) {
    cuts.push(
      await sharp(strip)
        .extract({ left: i * W, top: 0, width: W, height: H })
        /* Flattened: Apple refuses a screenshot carrying an alpha channel, and
           such a PNG uploads and then fails validation without saying why. */
        .flatten({
          background: theme.ground.type === "gradient" ? theme.ground.from : theme.ground.color,
        })
        .png()
        .toBuffer(),
    );
  }

  return { cuts, strip };
}
