import Database from "better-sqlite3";
import consola from "consola";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error("DB not initialized. Call initDb() first.");
  return db;
}

export function initDb(): void {
  const dataDir = process.env.DATA_DIR || "./data";
  const dbPath = join(dataDir, "gryt.db");

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  consola.info(`[DB] Connected to SQLite (${dbPath})`);
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

function toIso(d: Date): string {
  return d.toISOString();
}

function fromIso(s: string | null | undefined): Date {
  if (!s) return new Date(0);
  return new Date(s);
}

function mapRow(row: Record<string, unknown>): ImageJobRecord {
  return {
    job_id: row.job_id as string,
    file_id: row.file_id as string,
    status: row.status as ImageJobStatus,
    raw_s3_key: row.raw_s3_key as string,
    raw_content_type: row.raw_content_type as string,
    raw_bytes: (row.raw_bytes as number) || 0,
    error_message: (row.error_message as string) || null,
    created_at: fromIso(row.created_at as string),
    updated_at: fromIso(row.updated_at as string),
  };
}

export function listQueuedImageJobIds(
  limit: number,
): Array<{ job_id: string; created_at: Date }> {
  const d = getDb();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = d
    .prepare(
      "SELECT job_id, created_at FROM image_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
    )
    .all(safeLimit) as Array<{ job_id: string; created_at: string }>;
  return rows.map((r) => ({ job_id: r.job_id, created_at: fromIso(r.created_at) }));
}

export function getImageJob(jobId: string): ImageJobRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM image_jobs WHERE job_id = ?").get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapRow(row);
}

export function updateImageJobStatus(input: {
  job_id: string;
  status: ImageJobStatus;
  error_message?: string | null;
}): void {
  const d = getDb();
  const now = toIso(new Date());

  const sets: string[] = ["status = ?", "updated_at = ?"];
  const vals: unknown[] = [input.status, now];

  if (input.error_message !== undefined) {
    sets.push("error_message = ?");
    vals.push(input.error_message);
  }

  vals.push(input.job_id);
  d.prepare(`UPDATE image_jobs SET ${sets.join(", ")} WHERE job_id = ?`).run(...vals);
}

export function updateFileRecord(
  fileId: string,
  updates: { s3_key?: string; mime?: string; size?: number; thumbnail_key?: string | null },
): void {
  const d = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.s3_key !== undefined) {
    sets.push("s3_key = ?");
    vals.push(updates.s3_key);
  }
  if (updates.mime !== undefined) {
    sets.push("mime = ?");
    vals.push(updates.mime);
  }
  if (updates.size !== undefined) {
    sets.push("size = ?");
    vals.push(updates.size);
  }
  if (updates.thumbnail_key !== undefined) {
    sets.push("thumbnail_key = ?");
    vals.push(updates.thumbnail_key);
  }
  if (sets.length === 0) return;
  vals.push(fileId);
  d.prepare(`UPDATE files SET ${sets.join(", ")} WHERE file_id = ?`).run(...vals);
}

const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export function getUploadMaxBytes(): number {
  const d = getDb();
  const row = d
    .prepare("SELECT upload_max_bytes FROM server_config WHERE id = 'config'")
    .get() as { upload_max_bytes: number | null } | undefined;
  if (!row || row.upload_max_bytes == null) return DEFAULT_UPLOAD_MAX_BYTES;
  return row.upload_max_bytes;
}
