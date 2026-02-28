import consola from "consola";
import http from "http";

import {
  getImageJob,
  getUploadMaxBytes,
  initDb,
  listQueuedImageJobIds,
  updateFileRecord,
  updateImageJobStatus,
} from "./db";
import { processUploadedImage } from "./processImage";
import { initStorage } from "./storage";

function clampInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = value ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const concurrency = clampInt(process.env.IMAGE_WORKER_CONCURRENCY, 2, 1, 8);
const pollMs = clampInt(process.env.IMAGE_WORKER_POLL_MS, 1000, 250, 10_000);
const healthPort = clampInt(process.env.HEALTH_PORT, 8080, 1, 65535);

let inFlight = 0;
let processedCount = 0;
let errorCount = 0;

async function runOne(jobId: string): Promise<void> {
  const bucket = process.env.S3_BUCKET || "";
  try {
    const job = getImageJob(jobId);
    if (!job || job.status !== "queued") return;

    updateImageJobStatus({ job_id: jobId, status: "processing" });

    const maxBytes = getUploadMaxBytes();

    const result = await processUploadedImage(
      bucket,
      job.file_id,
      job.raw_s3_key,
      job.raw_content_type,
      job.raw_bytes,
      maxBytes,
    );

    const updates: { s3_key?: string; mime?: string; size?: number; thumbnail_key?: string | null } = {};
    if (result.compressed && result.newKey && result.newMime && result.newSize !== null) {
      updates.s3_key = result.newKey;
      updates.mime = result.newMime;
      updates.size = result.newSize;
    }
    if (result.thumbKey) {
      updates.thumbnail_key = result.thumbKey;
    }

    if (Object.keys(updates).length > 0) {
      updateFileRecord(job.file_id, updates);
    }

    updateImageJobStatus({ job_id: jobId, status: "done" });
    processedCount++;
    consola.info(
      `[ImageWorker] Job ${jobId} done (file=${job.file_id}, compressed=${result.compressed}, thumb=${!!result.thumbKey})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    consola.error(`[ImageWorker] Job ${jobId} failed:`, msg);
    errorCount++;
    try {
      updateImageJobStatus({ job_id: jobId, status: "error", error_message: msg });
    } catch (e) {
      consola.warn("Failed to update job status", e);
    }
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function tick(): void {
  if (inFlight >= concurrency) return;
  const capacity = concurrency - inFlight;
  let queued: Array<{ job_id: string }>;
  try {
    queued = listQueuedImageJobIds(capacity);
  } catch {
    return;
  }
  if (queued.length === 0) return;
  for (const { job_id } of queued) {
    if (inFlight >= concurrency) break;
    inFlight++;
    runOne(job_id)
      .catch((e) => consola.warn("tick error", e))
      .finally(() => {
        inFlight--;
      });
  }
}

function startHealthServer(): void {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        processed: processedCount,
        errors: errorCount,
        inFlight,
      }),
    );
  });
  server.listen(healthPort, () => {
    consola.info(`[ImageWorker] Health server on :${healthPort}`);
  });
}

function main(): void {
  consola.info("[ImageWorker] Starting...");
  consola.info(`[ImageWorker] concurrency=${concurrency}, pollMs=${pollMs}`);

  initStorage();
  initDb();

  startHealthServer();

  setInterval(() => {
    try {
      tick();
    } catch (e) {
      consola.warn("poll error", e);
    }
  }, pollMs);

  consola.info("[ImageWorker] Polling started");
}

main();
