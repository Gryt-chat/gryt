/* eslint-env node */

/**
 * What goes in each listing.
 *
 * One entry per set, and a set is what a person scrolls through in the store.
 * Order is the order they see, and the first two are the only ones most people
 * see at all — so the first panel says what Gryt is rather than starting a
 * feature tour.
 *
 * **Six panels built the same way is what every listing already looks like.**
 * This one runs four shapes: a statement, three feature panels, the owls, and
 * a command. See `panels.mjs`.
 *
 * **Headlines name what the screenshot shows.** Apple requires the image be
 * real app UI, so a headline promising something not on screen is both untrue
 * and a rejection. Keep them to what the capture behind them proves.
 */

import { ICONS } from "./icons.mjs";

/**
 * Gryt's own tokens, from `@gryt/theme`.
 *
 * Not a palette invented for the listing: `#111318` is the app's background and
 * `#968FF8` its accent, so a framed phone on this ground reads as one object
 * rather than a screenshot pasted onto a poster.
 */
const dark = {
  ground: { type: "solid", color: "#111318" },
  surface: "#1a1d24",
  border: "#2b303d",
  muted: "#888888",
  accentMuted: "#7d76d8",

  text: { top: 150 },
  icon: { size: 116, color: "#968FF8", gap: 48 },

  headline: {
    color: "#F5F6F8",
    weight: 600,
    sizes: [104, 92, 82, 72],
    lineHeight: 1.18,
    maxLines: 2,
    inset: 110,
    tracking: -1.5,
  },

  /** The opening panel. Left-aligned and larger, so it does not read as one of six. */
  statement: {
    inset: 110,
    weight: 700,
    sizes: [136, 120, 108],
    lineHeight: 1.08,
    tracking: -3,
    maxLines: 3,
    subSize: 56,
    subWeight: 400,
    subGap: 48,
    deviceGap: 120,
  },

  owls: { columns: 4, gap: 28, inset: 110, radius: 40 },

  command: {
    inset: 110,
    height: 210,
    radius: 28,
    pad: 60,
    size: 58,
    subSize: 50,
    gap: 84,
    deviceGap: 150,
    prompt: "$  ",
  },

  device: { widthRatio: 0.82, gap: 90 },
};

export const sets = [
  {
    slug: "launch",
    devices: ["iphone-6.9", "ipad-13", "android-phone"],
    theme: dark,
    panels: [
      {
        kind: "statement",
        slug: "own-it",
        headline: "Chat and voice, on a server you run",
        sub: "Open source. One person builds it.",
        screenshot: "captures/iphone-6.9/home.png",
        /* Wider and lower than the feature panels, so it is cropped harder and
           reads as a backdrop to the claim rather than a screen to study. */
        deviceWidthRatio: 0.92,
      },
      {
        kind: "device",
        slug: "voice",
        icon: ICONS.voice,
        headline: "Tap a channel and you’re in the call",
        screenshot: "captures/iphone-6.9/voice.png",
      },
      {
        kind: "device",
        slug: "screen",
        icon: ICONS.screen,
        headline: "Share a screen at the quality you pick",
        screenshot: "captures/iphone-6.9/screen.png",
      },
      {
        kind: "device",
        slug: "encrypted",
        icon: ICONS.encrypted,
        headline: "Direct messages the server can’t read",
        screenshot: "captures/iphone-6.9/encrypted.png",
      },
      {
        kind: "owls",
        slug: "owls",
        icon: ICONS.community,
        headline: "Everyone gets an owl. People draw the hats.",
        /* Real seeds through `@gryt/owl`, so the panel shows what the app would
           actually draw rather than a picture of some owls. */
        seeds: [
          "sivert", "ada", "mallory", "bo", "juniper", "tor", "wren", "kesh",
          "nils", "opal", "rune", "vega", "hild", "marek", "senna", "yuki",
          "beck", "ilse", "orla", "tam", "greta", "dax", "noor", "pip",
          "elva", "sol", "hark", "mira", "ozan", "linnea", "cass", "brynn",
          "aud", "finch", "kaia", "roscoe", "thea", "vidar", "esme", "jori",
        ],
      },
      {
        kind: "command",
        slug: "selfhost",
        icon: ICONS.selfhost,
        headline: "Run the whole thing yourself",
        /* The real quick-start command, not a plausible-looking one. */
        command: "docker compose up -d",
        sub: "The server, the calls and the files, all on your machine.",
        screenshot: "captures/iphone-6.9/server.png",
      },
    ],
  },
];
