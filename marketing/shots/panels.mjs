/* eslint-env node */

/**
 * The four shapes a panel can take.
 *
 * Six panels built the same way is what every app store listing already looks
 * like, and a person scrolling past has no reason to stop on the fourth. So the
 * set has a rhythm: a statement, three feature panels, the owls, and a command.
 * Four shapes across six panels reads as designed rather than filled in.
 *
 * Each kind returns SVG for the panel's top half and, where it wants one, the y
 * a device should sit at. Kinds that draw their own lower half — `owls`,
 * `command` — return `deviceTop: null` and no phone is composited.
 */

import { owlAvatarSvg } from "@gryt/owl";
import sharp from "sharp";

import { baselineOffset, fit, glyphs, measure, wrap } from "./text.mjs";

/* ────────────────────────────────────────────────────────────── helpers ── */

function iconSvg(icon, { size, colour, x, y }) {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(size / 256).toFixed(4)})" fill="${colour}">${icon}</g>`;
}

/**
 * A block of text, laid out from `y` downward, and where it ends.
 *
 * `anchor` is passed through rather than assumed centred: the statement panel
 * is left-aligned on purpose, and a set where one panel breaks the centre line
 * is the difference between six posters and a sequence.
 */
function block(lines, { font, weight, size, tracking, lineHeight, fill, x, y, anchor }) {
  const out = [];
  const lh = size * lineHeight;
  const base = baselineOffset(font, size, lh);
  let cursor = y;
  for (const line of lines) {
    out.push(glyphs(line, { font, weight, size, tracking, x, y: cursor + base, fill, anchor }));
    cursor += lh;
  }
  return { svg: out.join(""), bottom: cursor };
}

/* ──────────────────────────────────────────────────────────────── kinds ── */

/**
 * The opening panel: what this is, before any feature is named.
 *
 * Left-aligned and without an icon, so it does not read as the first of six
 * feature cards. The phone sits lower and is cropped harder — it is there to
 * say "this is an app", not to be examined.
 */
function statement({ panel, theme, font, W }) {
  const t = theme.statement;
  const inset = t.inset;
  const maxWidth = W - inset * 2;

  const { size, lines } = fit(panel.headline, {
    font, weight: t.weight, tracking: t.tracking,
    maxWidth, maxLines: t.maxLines, sizes: t.sizes,
  });

  const head = block(lines, {
    font, weight: t.weight, size, tracking: t.tracking,
    lineHeight: t.lineHeight, fill: theme.headline.color,
    x: inset, y: theme.text.top, anchor: "start",
  });

  let svg = head.svg;
  let bottom = head.bottom;

  if (panel.sub) {
    const subLines = wrap(panel.sub, maxWidth, { font, weight: t.subWeight, size: t.subSize });
    const sub = block(subLines, {
      font, weight: t.subWeight, size: t.subSize, tracking: 0,
      lineHeight: 1.35, fill: theme.muted,
      x: inset, y: bottom + t.subGap, anchor: "start",
    });
    svg += sub.svg;
    bottom = sub.bottom;
  }

  return { svg, deviceTop: Math.round(bottom + t.deviceGap) };
}

/** The workhorse: icon, headline, phone. Three of the six. */
function device({ panel, theme, font, W, headlineSize }) {
  const out = [];
  let y = theme.text.top;

  if (panel.icon) {
    out.push(
      iconSvg(panel.icon, {
        size: theme.icon.size,
        colour: theme.icon.color,
        x: (W - theme.icon.size) / 2,
        y,
      }),
    );
    y += theme.icon.size + theme.icon.gap;
  }

  const { size, lines } = fit(panel.headline, {
    font,
    weight: theme.headline.weight,
    tracking: theme.headline.tracking,
    maxWidth: W - theme.headline.inset * 2,
    maxLines: theme.headline.maxLines,
    sizes: headlineSize ? [headlineSize] : theme.headline.sizes,
  });

  const head = block(lines, {
    font, weight: theme.headline.weight, size, tracking: theme.headline.tracking,
    lineHeight: theme.headline.lineHeight, fill: theme.headline.color,
    x: W / 2, y, anchor: "middle",
  });

  out.push(head.svg);
  return { svg: out.join(""), bottom: head.bottom, deviceTop: null };
}

/**
 * The owls.
 *
 * The one panel no other app in this category can make: every account gets a
 * generated owl, and the accessories on them are drawn by the people using it.
 * Real output from `@gryt/owl`, not a picture of some — the seeds are in the
 * config, so what ships is what the app would draw.
 *
 * No phone here. A grid of avatars next to a phone showing a grid of avatars is
 * the same thing twice.
 */
async function owls({ panel, theme, font, W, H }) {
  const out = [];
  let y = theme.text.top;

  if (panel.icon) {
    out.push(
      iconSvg(panel.icon, {
        size: theme.icon.size,
        colour: theme.icon.color,
        x: (W - theme.icon.size) / 2,
        y,
      }),
    );
    y += theme.icon.size + theme.icon.gap;
  }

  const { size, lines } = fit(panel.headline, {
    font, weight: theme.headline.weight, tracking: theme.headline.tracking,
    maxWidth: W - theme.headline.inset * 2,
    maxLines: theme.headline.maxLines, sizes: theme.headline.sizes,
  });
  const head = block(lines, {
    font, weight: theme.headline.weight, size, tracking: theme.headline.tracking,
    lineHeight: theme.headline.lineHeight, fill: theme.headline.color,
    x: W / 2, y, anchor: "middle",
  });
  out.push(head.svg);

  const g = theme.owls;
  const cols = g.columns;
  const cell = Math.floor((W - g.inset * 2 - g.gap * (cols - 1)) / cols);
  const top = Math.round(head.bottom + g.gap * 2);
  const rows = Math.floor((H - top - g.inset) / (cell + g.gap));

  const tiles = [];
  const wanted = rows * cols;
  if (panel.seeds.length < wanted) {
    console.warn(
      `  owls panel has ${panel.seeds.length} seeds for ${wanted} tiles — they will repeat. Add ${wanted - panel.seeds.length} more.`,
    );
  }
  for (let i = 0; i < wanted; i++) {
    const seed = panel.seeds[i % panel.seeds.length];
    const svg = owlAvatarSvg(seed, {});
    /* Rasterised one at a time rather than inlined into the panel's SVG. An
       owl carries its own full-bleed background rect, and nesting sixteen of
       those inside one document leaves the corner rounding to librsvg. */
    const flat = await sharp(Buffer.from(svg)).resize(cell, cell).png().toBuffer();
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}"><rect width="${cell}" height="${cell}" rx="${g.radius}" fill="#fff"/></svg>`,
    );
    const rounded = await sharp(flat)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();

    tiles.push({
      input: rounded,
      left: g.inset + (i % cols) * (cell + g.gap),
      top: top + Math.floor(i / cols) * (cell + g.gap),
    });
  }

  return { svg: out.join(""), deviceTop: null, tiles };
}

/**
 * The command.
 *
 * The claim on the statement panel is that you run this yourself. This is the
 * evidence, and it is the real command out of the quick-start rather than a
 * plausible-looking one — a listing that shows a command which does not work is
 * worse than a listing that shows no command.
 */
function command({ panel, theme, font, W }) {
  const out = [];
  let y = theme.text.top;

  if (panel.icon) {
    out.push(
      iconSvg(panel.icon, {
        size: theme.icon.size,
        colour: theme.icon.color,
        x: (W - theme.icon.size) / 2,
        y,
      }),
    );
    y += theme.icon.size + theme.icon.gap;
  }

  const { size, lines } = fit(panel.headline, {
    font, weight: theme.headline.weight, tracking: theme.headline.tracking,
    maxWidth: W - theme.headline.inset * 2,
    maxLines: theme.headline.maxLines, sizes: theme.headline.sizes,
  });
  const head = block(lines, {
    font, weight: theme.headline.weight, size, tracking: theme.headline.tracking,
    lineHeight: theme.headline.lineHeight, fill: theme.headline.color,
    x: W / 2, y, anchor: "middle",
  });
  out.push(head.svg);

  const c = theme.command;
  const boxTop = Math.round(head.bottom + c.gap);
  const boxW = W - c.inset * 2;

  out.push(
    `<rect x="${c.inset}" y="${boxTop}" width="${boxW}" height="${c.height}" rx="${c.radius}"
       fill="${theme.surface}" stroke="${theme.border}" stroke-width="2"/>`,
  );

  /* Set in the body face rather than the mono one. Atkinson Mono is not
     vendored here, and a command in the wrong monospace reads as a screenshot
     of somebody else's terminal. The prompt character carries the meaning. */
  const textY = boxTop + c.height / 2 - (c.size * 1.2) / 2;
  const promptW = measure(c.prompt, { font, weight: 500, size: c.size });
  out.push(
    glyphs(c.prompt, {
      font, weight: 500, size: c.size, x: c.inset + c.pad, y: textY + baselineOffset(font, c.size, c.size * 1.2),
      fill: theme.accentMuted,
    }),
  );
  out.push(
    glyphs(panel.command, {
      font, weight: 600, size: c.size,
      x: c.inset + c.pad + promptW, y: textY + baselineOffset(font, c.size, c.size * 1.2),
      fill: theme.headline.color,
    }),
  );

  /* Measured, not assumed. The sub wraps to two lines on a narrower device, and
     a device y derived from the box alone puts the phone straight over it. */
  let bottom = boxTop + c.height;

  if (panel.sub) {
    const subLines = wrap(panel.sub, boxW, { font, weight: 400, size: c.subSize });
    const sub = block(subLines, {
      font, weight: 400, size: c.subSize, tracking: 0, lineHeight: 1.4,
      fill: theme.muted, x: W / 2, y: bottom + c.gap * 0.6, anchor: "middle",
    });
    out.push(sub.svg);
    bottom = sub.bottom;
  }

  /* A phone under the command, because the panel is 2868 tall and a box that
     ends a fifth of the way down leaves the rest empty. It also answers the
     obvious question the command raises — what you get once it is running. */
  return { svg: out.join(""), deviceTop: Math.round(bottom + c.deviceGap) };
}

export const KINDS = { statement, device, owls, command };
