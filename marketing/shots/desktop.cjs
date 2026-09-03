/* Microsoft Store screenshots of the desktop client.
 *
 * Run it with the client dev server up:
 *
 *   cd packages/client && npx vite --host --port 3666
 *   npx electron marketing/shots/desktop.cjs
 *
 * Separate from capture.mjs on purpose. That one drives `xcrun simctl` and
 * photographs a booted simulator, which is the only way to reach the iOS app
 * and impossible for a desktop one. This loads the real renderer into a hidden
 * Electron window instead, so nothing appears on screen and every capture comes
 * out the same size. It also means this is the one device in devices.mjs that
 * needs no simulator and no hand-driving.
 *
 * The window asks for 1920x1080 and Windows returns 2400x1350 on a 4K display
 * at 125%. Those are real pixels, not upscaled, and the Store takes anything up
 * to 3840x2160.
 *
 * It joins demo.gryt.chat as a guest, so the captures hold demo conversations
 * and no real account. Running it repeatedly used to add a guest to that server
 * every time; it detects existing membership now, but the two from 2026-09-02
 * are still in the member list and visible in the committed set.
 */

const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const BASE = "http://localhost:3666";
const HOST = "demo.gryt.chat";
const CODE = "xytkjuwh8png";
const OUT = process.env.SHOT_OUT || join(__dirname, "captures", "desktop");

const W = 1920;
const H = 1080;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win, js) {
  return win.webContents.executeJavaScript(js, true);
}

async function shoot(win, name) {
  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, img.toPNG());
  console.log(`  ${name}.png  ${size.width}x${size.height}`);
  return size;
}

app.commandLine.appendSwitch("disable-features", "MediaFoundationVideoCapture");

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  win.setContentSize(W, H);

  console.log("loading app…");
  await win.loadURL(BASE);
  await sleep(3000);

  // The scheme cache. On a plain-http origin the client defaults to http for a
  // host it has never seen, and demo.gryt.chat answers http with a 301 that a
  // CORS fetch will not follow. Telling it https up front skips that.
  await run(win, `localStorage.setItem("serverSchemeOverrides", ${JSON.stringify(JSON.stringify({ [HOST]: "https" }))}); true`);

  console.log("joining demo server…");
  await win.loadURL(`${BASE}/invite?host=${HOST}&code=${CODE}`);
  await sleep(6000);

  await run(win, `
    (() => {
      const b = [...document.querySelectorAll('button')];
      const look = b.find(x => /look myself/i.test(x.textContent || ''));
      if (look) look.click();
      return !!look;
    })()
  `);
  await sleep(1500);

  /* Accept if this identity is new, dismiss if it is not. Re-running used to
     land on "You are already a member of this server", and that dialog sits
     over the whole app — which is what the second run photographed. */
  const joined = await run(win, `
    (() => {
      const b = [...document.querySelectorAll('button')];
      const accept = b.find(x => /Accept Invite/i.test(x.textContent || ''));
      if (accept) { accept.click(); return "joined"; }
      const go = b.find(x => /Go to Server/i.test(x.textContent || ''));
      if (go) { go.click(); return "already-member"; }
      return "no-dialog";
    })()
  `);
  console.log("invite:", joined);
  await sleep(9000);

  /* Back to a clean URL. Leaving ?host=&code= in the address means any reload
     re-opens the invite dialog. */
  await win.loadURL(BASE);
  await sleep(7000);
  await run(win, `
    (() => {
      const b = [...document.querySelectorAll('button')];
      const look = b.find(x => /look myself/i.test(x.textContent || ''));
      if (look) look.click();
      const dismiss = b.find(x => /^Dismiss$/i.test((x.textContent || '').trim()));
      if (dismiss) dismiss.click();
      return true;
    })()
  `);
  await sleep(2500);

  // The browser-only banner, which does not belong in a desktop screenshot.
  await run(win, `
    (() => {
      const d = [...document.querySelectorAll('button')].find(
        x => /Dismiss banner/i.test(x.getAttribute('aria-label') || x.textContent || ''));
      if (d) d.click();
      return !!d;
    })()
  `);
  await sleep(2500);

  const state = await run(win, `document.body.innerText.slice(0, 200)`);
  console.log("state:", JSON.stringify(state.slice(0, 120)));

  console.log("capturing…");

  /* Every channel by name, including the first.
   *
   * There used to be an unnamed opening capture taken wherever the app
   * happened to be. The client remembers the last channel across runs, so on
   * the second run that was already "watching" — the opening shot and the
   * watching shot came out byte-identical, and both got committed before
   * anybody noticed. Naming every capture after the channel it clicked means a
   * duplicate is a duplicate of something, and shows up as one. */
  const channels = ["start-here", "general", "homelab", "gaming", "watching"];
  for (const name of channels) {
    const clicked = await run(win, `
      (() => {
        const el = [...document.querySelectorAll('button, a, [role="button"]')]
          .find(x => (x.textContent || '').trim() === ${JSON.stringify(name)});
        if (el) el.click();
        return !!el;
      })()
    `);
    if (!clicked) {
      console.log(`  (no channel "${name}")`);
      continue;
    }

    /* Wait for the channel to actually arrive, not for a stopwatch.
     *
     * Counting timestamps alone does not work: the outgoing channel's messages
     * are still in the DOM at the moment of the click, so the count passes
     * immediately and the capture lands on the incoming channel's loading
     * skeletons. Those are grey bars, and they photograph like a broken app.
     *
     * The composer placeholder is the reliable half — it says "Message #name"
     * and changes only once the switch has committed. Wait for that first,
     * then for messages under it. */
    /* A generous fixed settle, having tried and failed to be clever about it.
     *
     * Counting timestamps does not work: the outgoing channel's messages are
     * still in the DOM when the click lands, so the count passes instantly and
     * the capture gets the incoming channel's loading skeletons, which
     * photograph like a broken app. Watching the composer placeholder does not
     * work either — the composer is not a plain input and the selector for it
     * kept missing.
     *
     * The messages do arrive, they are just slower than the two or three
     * seconds first allowed. Waiting twelve is dull and it is right, and this
     * script runs five times rather than five thousand. */
    await sleep(12000);

    const stamps = await run(win, `
      (document.body.innerText.match(/\\b(Yesterday|Today) at\\b/g) || []).length
    `);
    if (stamps < 2) console.log(`  (looks empty: ${name})`);
    await shoot(win, `channel-${name}`);
  }

  console.log("done ->", OUT);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
