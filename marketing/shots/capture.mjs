/* eslint-env node */

/**
 * Take one screenshot off a booted simulator, into the right place and at the
 * right size.
 *
 * **It does not drive the app.** Getting to a channel with a real conversation
 * in it, or into a call with somebody, is a sequence that changes with the UI
 * and that a script guessing at deep links gets subtly wrong — a screenshot of
 * the wrong screen is worse than no screenshot, because it looks finished.
 * Drive the app by hand, then run this.
 *
 * What it does do is the part that is easy to get wrong by hand: capture from
 * the device whose frame the set uses, name the file what the config expects,
 * and refuse a capture whose dimensions are not the frame's aperture. A
 * mismatched capture still renders — it is resampled with a warning — but it
 * will be a touch soft, and on a store listing that is visible.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { DEVICES } from "./devices.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function simctl(args) {
  return execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
}

function bootedUdids() {
  const json = JSON.parse(simctl(["list", "devices", "booted", "--json"]));
  return Object.values(json.devices)
    .flat()
    .map((d) => ({ udid: d.udid, name: d.name }));
}

export function capture({ deviceId, slug }) {
  const device = DEVICES[deviceId];
  if (!device) throw new Error(`unknown device "${deviceId}"`);
  if (!device.simulator) {
    throw new Error(
      `${deviceId} has no simulator — capture it off a real device or an emulator and drop the file in captures/${deviceId}/`,
    );
  }

  const booted = bootedUdids();
  if (booted.length === 0) {
    throw new Error(`no simulator is booted. Boot ${device.simulator} and open Gryt on it first.`);
  }

  /* Matched by name rather than taking whatever is booted. Several simulators
     are often up at once on this machine, and a capture off the wrong one is
     the wrong size — which the check below catches, but the message is clearer
     coming from here. */
  const match = booted.find((d) => d.name === device.simulator);
  if (!match) {
    throw new Error(
      `${device.simulator} is not booted. Booted: ${booted.map((d) => d.name).join(", ") || "none"}`,
    );
  }

  const dir = join(here, "captures", deviceId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.png`);

  simctl(["io", match.udid, "screenshot", file]);
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [deviceId, slug] = process.argv.slice(2);
  if (!deviceId || !slug) {
    console.error("usage: node capture.mjs <device> <slug>");
    console.error(`devices: ${Object.keys(DEVICES).join(", ")}`);
    process.exit(1);
  }

  const file = capture({ deviceId, slug });
  const { width, height } = await sharp(file).metadata();
  const want = DEVICES[deviceId].capture;

  console.log(`${file}  ${width}x${height}`);
  if (width !== want.width || height !== want.height) {
    console.warn(
      `warning: expected ${want.width}x${want.height} for ${deviceId}. ` +
        `This will be resampled into the frame and go slightly soft.`,
    );
    process.exitCode = 1;
  }
}
