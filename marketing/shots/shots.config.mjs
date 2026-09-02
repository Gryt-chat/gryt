/* eslint-env node */

/**
 * What goes in each listing.
 *
 * **A strip, not six cards.** Everything below is placed against one canvas six
 * panels wide and cut at the end, so a phone can leave one panel and arrive in
 * the next. Scrolling the carousel then reads as panning across one picture.
 * See `strip.mjs`.
 *
 * Coordinates are in strip units: `x` counts panels across, `y` is a fraction
 * of panel height. `x: 1.6` is a little past halfway through panel two.
 *
 * **Every panel still has to survive being looked at alone**, because the first
 * one always is, and the store shows them one at a time with a sliver of the
 * next. No panel here is only the middle of a phone.
 *
 * **Headlines name what the screenshot shows.** Apple requires the image be
 * real app UI, so a headline promising something not on screen is untrue and a
 * rejection both.
 */

/**
 * Gryt's own colours, not a palette invented for a listing.
 *
 * `#2E2D5F` is the ground of the logo — the deep indigo the mark sits on — and
 * `#968FF8` is the app's accent. Using the logo's ground rather than the app's
 * near-black `#111318` is deliberate: on a shelf of dark-grey chat apps, indigo
 * is the thing that reads from a thumbnail.
 */
const C = {
  ground: "#2E2D5F",
  groundDeep: "#232249",
  accent: "#968FF8",
  accentLight: "#B4AFFF",
  onAccent: "#171436",
  white: "#FFFFFF",
  dim: "#BFBCE0",
};

const theme = {
  ground: { type: "gradient", from: C.ground, to: C.groundDeep },

  text: {
    eyebrow: { size: 40, weight: 700, tracking: 6, color: C.accentLight, gap: 30, onBandColor: "#3B2F86" },
    headline: {
      sizes: [118, 104, 92, 82],
      weight: 700, tracking: -2.5, lineHeight: 1.08, maxLines: 3,
      color: C.white, inset: 100,
    },
    /** Smaller, for the panels where the device is the subject. */
    headlineSm: {
      sizes: [86, 76, 68],
      weight: 700, tracking: -1.8, lineHeight: 1.12, maxLines: 3,
      color: C.white, inset: 100,
    },
    /** Dark, for the block of accent that runs across panels three and four. */
    onBand: {
      sizes: [104, 92, 82],
      weight: 700, tracking: -2.2, lineHeight: 1.08, maxLines: 3,
      color: C.onAccent, inset: 100,
    },
    sub: { size: 50, weight: 400, lineHeight: 1.36, color: C.dim, gap: 40 },
  },

  command: {
    height: 200, radius: 30, pad: 60, size: 58, prompt: "$  ",
    fill: "#1B1A3C", stroke: "#4A4788", color: C.white, promptColor: C.accent,
  },

  owlTile: { radius: 40 },
};

export const sets = [
  {
    slug: "launch",
    devices: ["iphone-6.9", "ipad-13", "android-phone"],
    theme,

    /**
     * The accent block behind panels three and four.
     *
     * It starts a third of the way into panel three and ends a third into four,
     * so neither panel is wholly on it — which stops the two reading as a
     * matched pair and keeps the strip moving. A per-panel renderer cannot make
     * a band end in the middle of a panel.
     */
    bands: [{ x: 1.78, width: 1.22, fill: C.accent }],

    text: [
      {
        x: 0.07, y: 0.05,
        eyebrow: "Gryt",
        text: "Chat and voice, on a server you run",
        sub: "Open source. One person builds it.",
        maxWidth: 0.86,
      },
      {
        style: "headlineSm", x: 1.07, y: 0.05,
        text: "Tap a channel and you’re in the call",
        maxWidth: 0.62,
      },
      {
        style: "onBand", x: 2.08, y: 0.06,
        eyebrow: "Sealed",
        text: "Direct messages the server can’t read",
        maxWidth: 0.84,
      },
      {
        style: "headlineSm", x: 3.07, y: 0.06,
        text: "Share a screen at the quality you pick",
        maxWidth: 0.6,
      },
      {
        x: 4.07, y: 0.05,
        eyebrow: "Everyone gets one",
        text: "The owls are drawn by hand",
        maxWidth: 0.86,
      },
      {
        style: "headlineSm", x: 5.07, y: 0.06,
        eyebrow: "Self-hosted",
        text: "Run the whole thing yourself",
        maxWidth: 0.86,
      },
      { x: 5.07, y: 0.36, command: "docker compose up -d" },
    ],

    /**
     * Five phones across six panels, three of them crossing a boundary.
     *
     * Angles are small on purpose. Past about ten degrees a phone stops reading
     * as a phone standing at an angle and starts reading as a picture somebody
     * rotated, and the store is full of the second kind.
     */
    phones: [
      { x: 0.80, y: 0.80, width: 0.72, angle: -8, screenshot: "captures/iphone-6.9/home.png" },
      { x: 1.78, y: 0.56, width: 0.60, angle: 7, screenshot: "captures/iphone-6.9/voice.png" },
      { x: 2.62, y: 0.84, width: 0.64, angle: -5, screenshot: "captures/iphone-6.9/encrypted.png" },
      { x: 3.70, y: 0.80, width: 0.58, angle: 6, screenshot: "captures/iphone-6.9/screen.png" },
      { x: 5.66, y: 0.82, width: 0.64, angle: -6, screenshot: "captures/iphone-6.9/server.png" },
    ],

    /**
     * The owl wall, filling panel five under its headline.
     *
     * Real output from `@gryt/owl`, which renders SVG from pure functions with
     * no DOM. The seeds are here, so what ships is what the app would draw
     * rather than a picture of some owls.
     */
    owls: {
      x: 4.07, y: 0.34,
      columns: 4, rows: 5, gap: 26, cell: 0.19,
      seeds: [
        "sivert", "ada", "mallory", "bo", "juniper", "tor", "wren",
        "kesh", "nils", "opal", "rune", "vega", "hild", "marek",
        "senna", "yuki", "beck", "ilse", "orla", "tam",
      ],
    },

    /** Panel filenames, in order. */
    slugs: ["own-it", "voice", "screen", "encrypted", "owls", "selfhost"],
  },
];
