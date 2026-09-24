#!/usr/bin/env node
// Every S3 call Gryt makes, with the server's own client and SDK version.
// Env: SERVER_DIR, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, S3_BUCKET.
const { createRequire } = require("node:module");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { writeFileSync, createReadStream, statSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const http = require("node:http");
const https = require("node:https");

const serverDir = process.env.SERVER_DIR || join(__dirname, "../../../packages/server");
const req = createRequire(join(serverDir, "package.json"));
const s3sdk = req("@aws-sdk/client-s3");
const { Upload } = req("@aws-sdk/lib-storage");
const { NodeHttpHandler } = req("@smithy/node-http-handler");
const { getSignedUrl } = req("@aws-sdk/s3-request-presigner");
const {
  S3Client, S3ServiceException, HeadBucketCommand, CreateBucketCommand, PutObjectCommand,
  GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, ListBucketsCommand,
  CreateMultipartUploadCommand, UploadPartCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand,
} = s3sdk;

// Copied from packages/server/src/storage/s3.ts initS3().
const client = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  requestHandler: new NodeHttpHandler({
    httpAgent: new http.Agent({ maxSockets: 5000, keepAlive: true }),
    httpsAgent: new https.Agent({ maxSockets: 5000, keepAlive: true }),
    socketAcquisitionWarningTimeout: 10_000,
  }),
});
const Bucket = process.env.S3_BUCKET || "gryt-eval";
const BIG_MB = Number(process.env.BIG_MB || 50);
const results = [];
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function bytesOf(body) {
  return Buffer.from(await body.transformToByteArray());
}

async function check(name, fn) {
  const t0 = performance.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - t0), note: note || "" });
  } catch (err) {
    results.push({ name, ok: false, ms: Math.round(performance.now() - t0), note: `${err.name}: ${err.message}`.slice(0, 200) });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function expectError(p, names) {
  try { await p; } catch (err) {
    assert(names.includes(err.name), `got ${err.name} (${err.$metadata?.httpStatusCode}), wanted ${names.join("|")}`);
    return err;
  }
  throw new Error(`no error, wanted ${names.join("|")}`);
}

// multipartPlan() from s3.ts, so the part size matches what the server sends.
function multipartPlan(size) {
  const needed = Math.ceil(size / Math.floor(10_000 * 0.95));
  const partSize = Math.max(8 * 1024 * 1024, Math.ceil(needed / (1024 * 1024)) * 1024 * 1024);
  const queueSize = Math.max(1, Math.min(4, Math.floor((64 * 1024 * 1024) / partSize)));
  return { partSize, queueSize };
}
async function uploadFile(Key, path, ContentType) {
  const { partSize, queueSize } = multipartPlan(statSync(path).size);
  const up = new Upload({ client, params: { Bucket, Key, Body: createReadStream(path), ContentType }, queueSize, partSize, leavePartsOnError: false });
  return up.done();
}

(async () => {
  const id = randomUUID();
  const small = randomBytes(40_000);
  const dir = mkdtempSync(join(tmpdir(), "gryt-eval-"));
  const bigPath = join(dir, "big.mp4");
  const big = randomBytes(BIG_MB * 1024 * 1024);
  writeFileSync(bigPath, big);
  const midPath = join(dir, "mid.png");
  const mid = randomBytes(3 * 1024 * 1024);
  writeFileSync(midPath, mid);

  // ensureBucket(): HeadBucket, and CreateBucket on a 404.
  await check("ensureBucket (HeadBucket 404 -> CreateBucket)", async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
      return "bucket already existed";
    } catch (err) {
      const missing = err.name === "NotFound" || err.name === "NoSuchBucket" ||
        (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404);
      assert(missing, `HeadBucket threw ${err.name} ${err.$metadata?.httpStatusCode}, not a 404`);
      await client.send(new CreateBucketCommand({ Bucket }));
      await client.send(new HeadBucketCommand({ Bucket }));
      return "created";
    }
  });

  await check("PutObject buffer + ContentType (avatars, emojis, thumbnails, worker)", async () => {
    await client.send(new PutObjectCommand({ Bucket, Key: `avatars/thumb_${id}.avif`, Body: small, ContentType: "image/avif" }));
  });
  await check("PutObject string body (SVG path)", async () => {
    await client.send(new PutObjectCommand({ Bucket, Key: `server-icons/127.0.0.1_5003/${id}.svg`, Body: "<svg xmlns='http://www.w3.org/2000/svg'/>", ContentType: "image/svg+xml" }));
  });
  await check("HeadObject size + ContentType", async () => {
    const h = await client.send(new HeadObjectCommand({ Bucket, Key: `avatars/thumb_${id}.avif` }));
    assert(h.ContentLength === small.length, `length ${h.ContentLength}`);
    assert(h.ContentType === "image/avif", `type ${h.ContentType}`);
  });
  await check("GetObject whole, bytes + ContentType back (server icon reads it)", async () => {
    const g = await client.send(new GetObjectCommand({ Bucket, Key: `avatars/thumb_${id}.avif` }));
    assert(sha(await bytesOf(g.Body)) === sha(small), "bytes differ");
    assert(g.ContentType === "image/avif", `type ${g.ContentType}`);
  });
  await check("GetObject missing key -> NoSuchKey", async () => {
    await expectError(client.send(new GetObjectCommand({ Bucket, Key: `uploads/${randomUUID()}.png` })), ["NoSuchKey"]);
  });
  await check("lib-storage Upload under one part (3 MB image)", async () => {
    await uploadFile(`uploads/${id}.png`, midPath, "image/png");
    const g = await client.send(new GetObjectCommand({ Bucket, Key: `uploads/${id}.png` }));
    assert(sha(await bytesOf(g.Body)) === sha(mid), "bytes differ");
  });
  let upMs = 0;
  await check(`lib-storage Upload multipart (${BIG_MB} MB, 8 MB parts, 4 in flight)`, async () => {
    const t0 = performance.now();
    await uploadFile(`uploads/${id}.mp4`, bigPath, "video/mp4");
    upMs = performance.now() - t0;
    const h = await client.send(new HeadObjectCommand({ Bucket, Key: `uploads/${id}.mp4` }));
    assert(h.ContentLength === big.length, `length ${h.ContentLength}`);
    assert(h.ContentType === "video/mp4", `type ${h.ContentType}`);
    return `${Math.round(upMs)} ms, ETag ${h.ETag}`;
  });
  await check(`GetObject whole ${BIG_MB} MB, checksum`, async () => {
    const g = await client.send(new GetObjectCommand({ Bucket, Key: `uploads/${id}.mp4` }));
    assert(sha(await bytesOf(g.Body)) === sha(big), "bytes differ");
  });
  const size = big.length;
  const ranges = [
    ["bytes=0-1023", 0, 1023],
    [`bytes=${size - 100}-`, size - 100, size - 1],
    ["bytes=-500", size - 500, size - 1],
    [`bytes=1000-${size + 99999}`, 1000, size - 1], // end past EOF is clamped
    [`bytes=${20 * 1024 * 1024}-${20 * 1024 * 1024 + 65535}`, 20 * 1024 * 1024, 20 * 1024 * 1024 + 65535], // crosses a part boundary? 16/24 MB
  ];
  for (const [Range, start, end] of ranges) {
    await check(`GetObject Range ${Range.replace(String(size), "SIZE")}`, async () => {
      const g = await client.send(new GetObjectCommand({ Bucket, Key: `uploads/${id}.mp4`, Range }));
      const b = await bytesOf(g.Body);
      assert(g.ContentRange === `bytes ${start}-${end}/${size}`, `ContentRange ${g.ContentRange}`);
      assert(g.ContentLength === end - start + 1, `ContentLength ${g.ContentLength}`);
      assert(sha(b) === sha(big.subarray(start, end + 1)), "bytes differ");
    });
  }
  await check("GetObject Range bytes=8388600-8388700 across the first part boundary", async () => {
    const g = await client.send(new GetObjectCommand({ Bucket, Key: `uploads/${id}.mp4`, Range: "bytes=8388600-8388700" }));
    assert(sha(await bytesOf(g.Body)) === sha(big.subarray(8388600, 8388701)), "bytes differ");
  });
  for (const Range of [`bytes=${size}-`, "bytes=-0"]) {
    await check(`GetObject Range ${Range.replace(String(size), "SIZE")} -> InvalidRange (route answers 416)`, async () => {
      await expectError(client.send(new GetObjectCommand({ Bucket, Key: `uploads/${id}.mp4`, Range })), ["InvalidRange"]);
    });
  }
  await check("Multipart abort leaves nothing (leavePartsOnError: false)", async () => {
    const Key = `uploads/${id}-aborted.mp4`;
    const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket, Key }));
    await client.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1, Body: big.subarray(0, 8 * 1024 * 1024) }));
    await client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
    const l = await client.send(new ListMultipartUploadsCommand({ Bucket }));
    assert(!(l.Uploads || []).some((u) => u.UploadId === UploadId), "upload still listed");
    await expectError(client.send(new HeadObjectCommand({ Bucket, Key })), ["NotFound", "NoSuchKey"]);
  });
  await check("DeleteObject existing", async () => {
    await client.send(new DeleteObjectCommand({ Bucket, Key: `uploads/${id}.png` }));
    await expectError(client.send(new HeadObjectCommand({ Bucket, Key: `uploads/${id}.png` })), ["NotFound", "NoSuchKey"]);
  });
  await check("DeleteObject missing key is not an error (sweeps re-run)", async () => {
    await client.send(new DeleteObjectCommand({ Bucket, Key: `uploads/${randomUUID()}.png` }));
  });
  await check("ListObjectsV2 with prefix (backup/mirror tools)", async () => {
    const l = await client.send(new ListObjectsV2Command({ Bucket, Prefix: "avatars/" }));
    assert((l.Contents || []).some((o) => o.Key === `avatars/thumb_${id}.avif`), "key not listed");
  });
  await check("ListBuckets (HA snapshot lists buckets)", async () => {
    const l = await client.send(new ListBucketsCommand({}));
    assert((l.Buckets || []).some((b) => b.Name === Bucket), "bucket not listed");
  });
  await check("Presigned GET URL (defined in s3.ts, no caller today)", async () => {
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: `avatars/thumb_${id}.avif` }), { expiresIn: 900 });
    const r = await fetch(url);
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(sha(Buffer.from(await r.arrayBuffer())) === sha(small), "bytes differ");
  });
  await check("PutObject ACL public-read (param exists, no caller sets it)", async () => {
    await client.send(new PutObjectCommand({ Bucket, Key: `emojis/acl-${id}.png`, Body: small, ContentType: "image/png", ACL: "public-read" }));
  });

  // Hold the store under the upload long enough for `docker stats` to see it.
  const loadUntil = Date.now() + Number(process.env.LOAD_SECONDS || 0) * 1000;
  let rounds = 0;
  while (Date.now() < loadUntil) {
    await uploadFile(`uploads/load-${rounds % 4}.mp4`, bigPath, "video/mp4");
    await bytesOf((await client.send(new GetObjectCommand({ Bucket, Key: `uploads/load-${rounds % 4}.mp4`, Range: "bytes=1000000-" }))).Body);
    rounds++;
  }
  if (rounds) console.log(`load: ${rounds} rounds of a ${BIG_MB} MB multipart upload and ranged read`);

  const pad = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(pad)}  ${String(r.ms).padStart(6)} ms  ${r.note}`);
  console.log(JSON.stringify({ endpoint: process.env.S3_ENDPOINT, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, uploadMBps: upMs ? +(BIG_MB / (upMs / 1000)).toFixed(1) : null }));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
