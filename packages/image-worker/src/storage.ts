import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";

interface StorageBackend {
  getObjectAsBuffer(bucket: string, key: string): Promise<Buffer>;
  putObject(bucket: string, key: string, body: Buffer, contentType?: string): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
}

// ── S3 backend ──────────────────────────────────────────────────────────────

let s3: S3Client | null = null;

function getS3(): S3Client {
  if (!s3) throw new Error("S3 not initialized");
  return s3;
}

const s3Backend: StorageBackend = {
  async getObjectAsBuffer(bucket, key) {
    const res = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = res.Body;
    if (!body) throw new Error(`Empty S3 body for ${key}`);
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  },

  async putObject(bucket, key, body, contentType) {
    await getS3().send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  },

  async deleteObject(bucket, key) {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};

// ── Filesystem backend ──────────────────────────────────────────────────────

let fsDataDir: string | null = null;

function resolvePath(bucket: string, key: string): string {
  if (!fsDataDir) throw new Error("Filesystem storage not initialized");
  return join(fsDataDir, bucket, key);
}

const fsBackend: StorageBackend = {
  async getObjectAsBuffer(bucket, key) {
    const filePath = resolvePath(bucket, key);
    if (!existsSync(filePath)) {
      const err = new Error(`Object not found: ${key}`);
      (err as NodeJS.ErrnoException).code = "NoSuchKey";
      throw err;
    }
    return readFile(filePath);
  },

  async putObject(bucket, key, body, contentType) {
    const filePath = resolvePath(bucket, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    if (contentType) {
      await writeFile(filePath + ".meta", JSON.stringify({ contentType }));
    }
  },

  async deleteObject(bucket, key) {
    const filePath = resolvePath(bucket, key);
    try {
      await unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    try {
      await unlink(filePath + ".meta");
    } catch {
      /* meta file may not exist */
    }
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

let backend: StorageBackend | null = null;

function getBackend(): StorageBackend {
  if (!backend) throw new Error("Storage not initialized. Call initStorage() first.");
  return backend;
}

export function initStorage(): void {
  const storageType = (process.env.STORAGE_BACKEND || "s3").toLowerCase();
  if (storageType === "filesystem") {
    fsDataDir = process.env.DATA_DIR || "./data";
    backend = fsBackend;
  } else {
    s3 = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
    backend = s3Backend;
  }
}

export function getObjectAsBuffer(bucket: string, key: string): Promise<Buffer> {
  return getBackend().getObjectAsBuffer(bucket, key);
}

export function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  return getBackend().putObject(bucket, key, body, contentType);
}

export function deleteObject(bucket: string, key: string): Promise<void> {
  return getBackend().deleteObject(bucket, key);
}
