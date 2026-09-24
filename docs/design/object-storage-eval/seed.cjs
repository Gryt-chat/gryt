// About 1 GiB in the server's key layout, for the migration test.
// Same env as s3-matrix.cjs. Random bytes, so nothing compresses or dedups.
const { createRequire } = require("node:module");
const { randomBytes, randomUUID } = require("node:crypto");
const { join } = require("node:path");
const req = createRequire(join(process.env.SERVER_DIR || join(__dirname, "../../../packages/server"), "package.json"));
const { S3Client, PutObjectCommand } = req("@aws-sdk/client-s3");
const { Upload } = req("@aws-sdk/lib-storage");

const client = new S3Client({
  region: process.env.S3_REGION || "auto", endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const Bucket = process.env.S3_BUCKET || "gryt";
const KB = 1024, MB = 1024 * 1024;

// [count, key(), bytes, content type]
const plan = [
  [12, () => `uploads/${randomUUID()}.mp4`, 50 * MB, "video/mp4"],
  [150, () => `uploads/${randomUUID()}.png`, 2 * MB, "image/png"],
  [40, () => `uploads/${randomUUID()}.bin`, 1 * MB, "application/octet-stream"],
  [1500, () => `thumbnails/${randomUUID()}.avif`, 30 * KB, "image/avif"],
  [300, () => `avatars/${randomUUID()}.webp`, 100 * KB, "image/webp"],
  [300, () => `avatars/thumb_${randomUUID()}.avif`, 10 * KB, "image/avif"],
  [200, (i) => `emojis/emoji_${i}.png`, 20 * KB, "image/png"],
  [50, () => `emoji_raw/${randomUUID()}`, 40 * KB, "image/gif"],
  [20, () => `server-icons/gryt.example.com/${randomUUID()}.svg`, 2 * KB, "image/svg+xml"],
];

async function put(Key, size, ContentType) {
  const Body = randomBytes(size);
  if (size > 8 * MB) {
    await new Upload({ client, params: { Bucket, Key, Body, ContentType }, partSize: 8 * MB, queueSize: 4 }).done();
  } else {
    await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
  }
}

(async () => {
  const jobs = [];
  for (const [count, key, size, type] of plan) for (let i = 0; i < count; i++) jobs.push([key(i), size, type]);
  let bytes = 0;
  const t0 = Date.now();
  for (let i = 0; i < jobs.length; i += 16) {
    await Promise.all(jobs.slice(i, i + 16).map(([k, s, t]) => put(k, s, t)));
    bytes += jobs.slice(i, i + 16).reduce((a, j) => a + j[1], 0);
  }
  console.log(`seeded ${jobs.length} objects, ${(bytes / MB).toFixed(0)} MiB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
