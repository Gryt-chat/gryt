/* eslint-env node */

/**
 * The devices a set can be rendered for, and what each store demands.
 *
 * Three numbers per device and they are all different things, which is where
 * this goes wrong if they are conflated:
 *
 *   - `capture` is what the simulator or emulator produces. It is the device's
 *     screen in pixels, and it is also exactly the frame's aperture, so a raw
 *     capture composites at 1:1 with no resampling.
 *   - `output` is what the store accepts for the listing. Nothing else.
 *   - `frame` is the PNG with a transparent screen.
 *
 * `output` is not `capture`. A 6.9" App Store panel is 1320x2868 while the
 * iPhone 17 Pro captures 1206x2622 — the panel is a poster the phone sits on,
 * not the phone's screen blown up.
 *
 * **Frames are not committed.** They are Apple's and Google's marketing assets
 * and this repository is public. `frames/` is gitignored and README.md says
 * where to get them; `resolveFrame` fails with that instruction rather than
 * rendering something wrong.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, "frames");

export const DEVICES = {
  /**
   * The one App Store set that is actually required for an iPhone app.
   * 1290x2796 is accepted too; 1320x2868 is what Apple recommends, and a set
   * built at the larger size can be downscaled without going soft.
   */
  "iphone-6.9": {
    label: 'iPhone 6.9"',
    store: "app-store",
    output: { width: 1320, height: 2868 },
    capture: { width: 1206, height: 2622 },
    frame: "iPhone 17 Pro - Silver - Portrait.png",
    simulator: "iPhone 17 Pro",
  },

  /** Required if the app runs on iPad, which Gryt's does. */
  "ipad-13": {
    label: 'iPad 13"',
    store: "app-store",
    output: { width: 2064, height: 2752 },
    capture: { width: 2064, height: 2752 },
    frame: "iPad Pro 13 - Silver - Portrait.png",
    simulator: "iPad Pro 13-inch (M5)",
  },

  /**
   * Play's phone set. The console takes a range rather than one size; 1080x1920
   * is the safe middle and what the listing already uses elsewhere.
   */
  "android-phone": {
    label: "Android phone",
    store: "play",
    output: { width: 1080, height: 1920 },
    capture: { width: 1080, height: 2400 },
    frame: "android-phone.png",
    simulator: null,
  },
};

export function resolveFrame(deviceId) {
  const device = DEVICES[deviceId];
  if (!device) throw new Error(`unknown device "${deviceId}"`);

  const path = join(framesDir, device.frame);
  if (!existsSync(path)) {
    throw new Error(
      `missing frame for ${deviceId}: ${path}\n` +
        `Frames are not committed — this repository is public and they are the vendors' assets.\n` +
        `See marketing/shots/README.md for where to download it.`,
    );
  }
  return path;
}
