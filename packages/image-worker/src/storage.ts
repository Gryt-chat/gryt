import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

let s3: S3Client | null = null;

export function initS3(): void {
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
}

function getS3(): S3Client {
  if (!s3) throw new Error("S3 not initialized");
  return s3;
}

export async function getObjectAsBuffer(bucket: string, key: string): Promise<Buffer> {
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = res.Body;
  if (!body) throw new Error(`Empty S3 body for ${key}`);
  const bytes = await body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}
