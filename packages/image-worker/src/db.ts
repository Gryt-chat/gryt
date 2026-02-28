import { Client } from "cassandra-driver";
import consola from "consola";

let client: Client | null = null;

export function getClient(): Client {
  if (!client) throw new Error("DB not initialized");
  return client;
}

export async function initDb(): Promise<void> {
  const contactPoints = (process.env.SCYLLA_CONTACT_POINTS || "localhost").split(",");
  const localDataCenter = process.env.SCYLLA_LOCAL_DATACENTER || "datacenter1";
  const keyspace = process.env.SCYLLA_KEYSPACE || "gryt";

  client = new Client({ contactPoints, localDataCenter, keyspace });
  await client.connect();
  consola.info(`[DB] Connected to ScyllaDB (keyspace=${keyspace})`);
}

export type ImageJobStatus = "queued" | "processing" | "done" | "error";

export interface ImageJobRecord {
  job_id: string;
  file_id: string;
  status: ImageJobStatus;
  raw_s3_key: string;
  raw_content_type: string;
  raw_bytes: number;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

function statusFromDb(value: unknown): ImageJobStatus {
  const v = typeof value === "string" ? value : "";
  if (v === "queued" || v === "processing" || v === "done" || v === "error") return v;
  return "error";
}

export async function listQueuedImageJobIds(
  limit: number,
): Promise<Array<{ job_id: string; created_at: Date }>> {
  const c = getClient();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rs = await c.execute(
    `SELECT created_at, job_id FROM server_image_jobs_by_status WHERE status = ? LIMIT ${safeLimit}`,
    ["queued"],
    { prepare: true },
  );
  return rs.rows.map((r) => ({
    job_id: r["job_id"].toString(),
    created_at: r["created_at"],
  }));
}

export async function getImageJob(job_id: string): Promise<ImageJobRecord | null> {
  const c = getClient();
  const rs = await c.execute(
    `SELECT job_id, file_id, status, raw_s3_key, raw_content_type, raw_bytes, error_message, created_at, updated_at
     FROM server_image_jobs_by_id WHERE job_id = ?`,
    [job_id],
    { prepare: true },
  );
  const r = rs.first();
  if (!r) return null;
  return {
    job_id: r["job_id"].toString(),
    file_id: r["file_id"].toString(),
    status: statusFromDb(r["status"]),
    raw_s3_key: r["raw_s3_key"],
    raw_content_type: r["raw_content_type"],
    raw_bytes: Number(r["raw_bytes"] ?? 0),
    error_message: r["error_message"] ?? null,
    created_at: r["created_at"],
    updated_at: r["updated_at"],
  };
}

export async function updateImageJobStatus(input: {
  job_id: string;
  status: ImageJobStatus;
  error_message?: string | null;
}): Promise<void> {
  const c = getClient();
  const existing = await getImageJob(input.job_id);
  if (!existing) return;

  const updated_at = new Date();
  const nextStatus = input.status;
  const error_message = input.error_message ?? existing.error_message;

  await c.execute(
    `UPDATE server_image_jobs_by_id SET status = ?, error_message = ?, updated_at = ? WHERE job_id = ?`,
    [nextStatus, error_message, updated_at, input.job_id],
    { prepare: true },
  );

  await c.execute(
    `INSERT INTO server_image_jobs_by_status (status, created_at, job_id, file_id, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [nextStatus, existing.created_at, input.job_id, existing.file_id, updated_at],
    { prepare: true },
  );

  await c.execute(
    `DELETE FROM server_image_jobs_by_status WHERE status = ? AND created_at = ? AND job_id = ?`,
    [existing.status, existing.created_at, input.job_id],
    { prepare: true },
  );
}

export async function updateFileRecord(
  fileId: string,
  updates: { s3_key?: string; mime?: string; size?: number; thumbnail_key?: string | null },
): Promise<void> {
  const c = getClient();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.s3_key !== undefined) { sets.push("s3_key = ?"); vals.push(updates.s3_key); }
  if (updates.mime !== undefined) { sets.push("mime = ?"); vals.push(updates.mime); }
  if (updates.size !== undefined) { sets.push("size = ?"); vals.push(updates.size); }
  if (updates.thumbnail_key !== undefined) { sets.push("thumbnail_key = ?"); vals.push(updates.thumbnail_key); }
  if (sets.length === 0) return;
  vals.push(fileId);
  await c.execute(`UPDATE files_by_id SET ${sets.join(", ")} WHERE file_id = ?`, vals, { prepare: true });
}

const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const SERVER_CONFIG_ID = "config";

export async function getUploadMaxBytes(): Promise<number> {
  const c = getClient();
  const rs = await c.execute(
    `SELECT upload_max_bytes FROM server_config_singleton WHERE id = ?`,
    [SERVER_CONFIG_ID],
    { prepare: true },
  );
  const r = rs.first();
  if (!r) return DEFAULT_UPLOAD_MAX_BYTES;
  const val = r["upload_max_bytes"];
  return typeof val === "number" ? val : Number(val ?? DEFAULT_UPLOAD_MAX_BYTES);
}
