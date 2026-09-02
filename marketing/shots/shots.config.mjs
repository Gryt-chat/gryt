/* eslint-env node */

/**
 * What goes in each listing.
 *
 * One entry per set, and a set is what a person scrolls through in the store.
 * Order is the order they see, and the first two are the only ones most people
 * see at all — so the first panel is the thing Gryt is, not a feature tour
 * warming up.
 *
 * **Headlines name what the screenshot shows.** Apple requires the image be
 * real app UI, so a headline promising something not on screen is both a lie
 * and a rejection. Keep them to what the capture behind them proves.
 */

import { ICONS } from "./icons.mjs";

/**
 * The dark ground the rest of Gryt's marketing uses.
 *
 * `#111318` is the app's own background, so a framed phone on it reads as one
 * object rather than a screenshot pasted onto a poster. The accent is stepped
 * down from the brand `#968FF8` for the same reason the share cards step it
 * down: white type does not clear contrast on the token itself.
 */
const dark = {
  ground: { type: "solid", color: "#111318" },
  text: { top: 150 },
  icon: { size: 116, color: "#968FF8", gap: 48 },
  headline: {
    color: "#F5F6F8",
    weight: 600,
    /* Tried largest first. A one-word headline gets the big size and a long one
       steps down rather than wrapping to four lines. */
    sizes: [104, 92, 82, 72],
    lineHeight: 1.18,
    maxLines: 2,
    inset: 110,
    tracking: -1.5,
  },
  device: { widthRatio: 0.82, gap: 90 },
};

/** The gradient variant from the second template. Unused until it is chosen. */
export const gradient = {
  ...dark,
  ground: { type: "gradient", from: "#6157d8", to: "#2b2f6e", angle: 155 },
  icon: { ...dark.icon, color: "#EEECFF" },
  headline: { ...dark.headline, color: "#FFFFFF" },
};

export const sets = [
  {
    slug: "launch",
    devices: ["iphone-6.9", "ipad-13", "android-phone"],
    theme: dark,
    panels: [
      {
        slug: "channels",
        icon: ICONS.chat,
        headline: "Channels for the people you actually talk to",
        screenshot: "captures/iphone-6.9/channels.png",
      },
      {
        slug: "voice",
        icon: ICONS.voice,
        headline: "Voice starts when you tap the channel",
        screenshot: "captures/iphone-6.9/voice.png",
      },
      {
        slug: "screen",
        icon: ICONS.screen,
        headline: "Share a screen at the quality you pick",
        screenshot: "captures/iphone-6.9/screen.png",
      },
      {
        slug: "encrypted",
        icon: ICONS.encrypted,
        headline: "Direct messages the server cannot read",
        screenshot: "captures/iphone-6.9/encrypted.png",
      },
      {
        slug: "community",
        icon: ICONS.community,
        headline: "Roles, invites and moderation from the phone",
        screenshot: "captures/iphone-6.9/community.png",
      },
      {
        slug: "selfhost",
        icon: ICONS.selfhost,
        headline: "Or run the whole thing on your own machine",
        screenshot: "captures/iphone-6.9/selfhost.png",
      },
    ],
  },
];
