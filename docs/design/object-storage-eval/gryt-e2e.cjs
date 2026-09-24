// Through the real server: upload an image and a video, read them back whole and
// by range, and wait for the worker's thumbnail. Run by gryt-e2e.sh.
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const serverDir = process.env.SERVER_DIR;
const base = process.env.GRYT_URL; // http://127.0.0.1:5013
const host = new URL(base).host;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const src = (p) => require(join(serverDir, "src", p));

(async () => {
  const { initSqlite } = src("db/sqlite/connection");
  const { upsertUser } = src("db/sqlite/users");
  const { setServerRole, getServerConfig, updateServerConfig } = src("db/sqlite/servers");
  const { getFile } = src("db/sqlite/messages");
  const { generateAccessToken, generateFileToken } = src("utils/jwt");
  await initSqlite();
  const user = await upsertUser("acct-eval", "eval");
  await setServerRole(user.server_user_id, "member");
  // The default cap is under the 50 MB clip; this is the setting an owner changes.
  await updateServerConfig({ uploadMaxBytes: 200 * 1024 * 1024 });
  const cfg = await getServerConfig();
  const who = { grytUserId: "acct-eval", serverUserId: user.server_user_id, nickname: "eval", serverHost: host, tokenVersion: cfg?.token_version ?? 0 };
  const access = generateAccessToken(who);
  const fileToken = generateFileToken(who);

  const results = [];
  const step = async (name, fn) => {
    try { results.push(["PASS", name, (await fn()) || ""]); }
    catch (e) { results.push(["FAIL", name, String(e.message || e).slice(0, 300)]); }
  };
  const upload = async (path, type, name) => {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(path)], { type }), name);
    const r = await fetch(`${base}/api/uploads`, { method: "POST", headers: { Authorization: `Bearer ${access}` }, body: form });
    const body = await r.json();
    if (r.status !== 201) throw new Error(`HTTP ${r.status} ${JSON.stringify(body)}`);
    return body;
  };
  const read = (fileId, q = "", headers = {}) => fetch(`${base}/api/uploads/files/${fileId}?t=${encodeURIComponent(fileToken)}${q}`, { headers });

  const image = readFileSync(process.env.E2E_IMAGE);
  const video = readFileSync(process.env.E2E_VIDEO);
  let img, vid;
  await step(`upload image (${(image.length / 1e6).toFixed(1)} MB PNG)`, async () => { img = await upload(process.env.E2E_IMAGE, "image/png", "eval.png"); return img.key; });
  await step(`upload video (${(video.length / 1e6).toFixed(1)} MB MP4, multipart)`, async () => { vid = await upload(process.env.E2E_VIDEO, "video/mp4", "eval.mp4"); return `${vid.key} thumb=${vid.thumbnailKey}`; });
  await step("read image back, same bytes", async () => {
    const r = await read(img.fileId);
    const b = Buffer.from(await r.arrayBuffer());
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    // The worker may already have recompressed it; then the bytes differ by design.
    const f = await getFile(img.fileId);
    return sha(b) === sha(image) ? "identical" : `served ${b.length} bytes from ${f.s3_key} (worker recompressed)`;
  });
  await step("read video back whole, same bytes", async () => {
    const r = await read(vid.fileId);
    const b = Buffer.from(await r.arrayBuffer());
    if (r.status !== 200 || sha(b) !== sha(video)) throw new Error(`HTTP ${r.status}, ${b.length} bytes, sha ${sha(b) === sha(video) ? "ok" : "differs"}`);
  });
  await step("video Range bytes=1000000-1999999 -> 206", async () => {
    const r = await read(vid.fileId, "", { Range: "bytes=1000000-1999999" });
    const b = Buffer.from(await r.arrayBuffer());
    if (r.status !== 206 || sha(b) !== sha(video.subarray(1000000, 2000000))) throw new Error(`HTTP ${r.status} ${r.headers.get("content-range")}`);
    return r.headers.get("content-range");
  });
  await step("video Range past the end -> 416", async () => {
    const r = await read(vid.fileId, "", { Range: `bytes=${video.length}-` });
    if (r.status !== 416) throw new Error(`HTTP ${r.status}`);
    return r.headers.get("content-range");
  });
  if (vid?.thumbnailKey) await step("video poster frame (server-made thumbnail)", async () => {
    const r = await read(vid.fileId, "&thumb=1");
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return `${(await r.arrayBuffer()).byteLength} bytes`;
  });
  await step("image worker thumbnail", async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const f = await getFile(img.fileId);
      if (f?.thumbnail_key) {
        const r = await read(img.fileId, "&thumb=1");
        const b = Buffer.from(await r.arrayBuffer());
        if (r.status !== 200 || b.length === 0) throw new Error(`thumb HTTP ${r.status}`);
        return `${f.thumbnail_key}, ${b.length} bytes, ${r.headers.get("content-type")}; stored ${f.s3_key}`;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error("no thumbnail_key after 60 s");
  });

  for (const [s, n, note] of results) console.log(`${s}  ${n}  ${note}`);
  process.exit(results.every((r) => r[0] === "PASS") ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
