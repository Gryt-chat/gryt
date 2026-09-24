// Compare two buckets by key, Content-Type and SHA-256. SRC_* and DST_* take ENDPOINT,
// KEY, SECRET, BUCKET; DST_DIR reads the filesystem backend's <key> and <key>.meta.
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const { createReadStream, existsSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");
const req = createRequire(join(process.env.SERVER_DIR || join(__dirname, "../../../packages/server"), "package.json"));
const { S3Client, ListObjectsV2Command, GetObjectCommand } = req("@aws-sdk/client-s3");

function side(p) {
  const e = (k) => process.env[`${p}_${k}`];
  if (e("DIR")) return { dir: e("DIR") };
  return {
    bucket: e("BUCKET") || "gryt",
    client: new S3Client({ region: "auto", endpoint: e("ENDPOINT"), forcePathStyle: true, credentials: { accessKeyId: e("KEY"), secretAccessKey: e("SECRET") } }),
  };
}
async function list(s) {
  const out = new Map();
  let ContinuationToken;
  do {
    const r = await s.client.send(new ListObjectsV2Command({ Bucket: s.bucket, ContinuationToken }));
    for (const o of r.Contents || []) out.set(o.Key, o.Size);
    ContinuationToken = r.NextContinuationToken;
  } while (ContinuationToken);
  return out;
}
async function digest(s, key) {
  const h = createHash("sha256");
  if (s.dir) {
    const p = join(s.dir, key);
    for await (const c of createReadStream(p)) h.update(c);
    const meta = existsSync(p + ".meta") ? JSON.parse(readFileSync(p + ".meta", "utf8")) : {};
    return { sha: h.digest("hex"), size: statSync(p).size, type: meta.contentType };
  }
  const r = await s.client.send(new GetObjectCommand({ Bucket: s.bucket, Key: key }));
  for await (const c of r.Body) h.update(c);
  return { sha: h.digest("hex"), size: r.ContentLength, type: r.ContentType };
}

(async () => {
  const src = side("SRC"), dst = side("DST");
  const keys = await list(src);
  const problems = [];
  let bytes = 0;
  const all = [...keys.keys()];
  for (let i = 0; i < all.length; i += 16) {
    await Promise.all(all.slice(i, i + 16).map(async (key) => {
      const a = await digest(src, key);
      let b;
      try { b = await digest(dst, key); } catch (e) { problems.push(`${key}: missing (${e.name || e.code})`); return; }
      bytes += a.size;
      if (a.sha !== b.sha) problems.push(`${key}: bytes differ`);
      if (a.type !== b.type) problems.push(`${key}: Content-Type ${a.type} -> ${b.type}`);
    }));
  }
  const dstCount = dst.dir ? "n/a" : (await list(dst)).size;
  console.log(JSON.stringify({ objects: keys.size, dstObjects: dstCount, mib: Math.round(bytes / 1048576), problems: problems.length }));
  for (const p of problems.slice(0, 10)) console.log("  " + p);
  process.exit(problems.length ? 1 : 0);
})();
