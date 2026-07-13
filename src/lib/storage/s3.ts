// ---------------------------------------------------------------------------
// S3 Storage Adapter - production file storage using AWS S3 or compatible
// services (MinIO, Cloudflare R2, DigitalOcean Spaces, etc.).
//
// Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (dynamic import
// so the app runs without these packages in demo mode).
//
// Required env vars:
//   S3_ENDPOINT   - e.g. https://s3.amazonaws.com or https://minio.local:9000
//   S3_BUCKET     - bucket name
//   S3_ACCESS_KEY - access key ID
//   S3_SECRET_KEY - secret access key
//   S3_REGION     - region (default: us-east-1)
//
// Optional:
//   S3_PUBLIC_URL - public CDN/base URL for read access (default: S3_ENDPOINT/S3_BUCKET)
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  publicUrl: string;
  forcePathStyle: boolean;
}

export function getS3Config(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;

  const region = process.env.S3_REGION || "us-east-1";
  // MinIO / R2 use path-style addressing; AWS S3 uses virtual-host-style
  const forcePathStyle = !endpoint.includes("amazonaws.com");
  const publicUrl = (process.env.S3_PUBLIC_URL || `${endpoint}/${bucket}`).replace(/\/$/, "");

  return { endpoint, bucket, accessKey, secretKey, region, publicUrl, forcePathStyle };
}

// Dynamically import AWS SDK (not installed in demo mode)
type S3Client = {
  send: (cmd: unknown) => Promise<unknown>;
};
type S3Module = {
  S3Client: new (config: unknown) => S3Client;
  PutObjectCommand: new (input: unknown) => unknown;
  GetObjectCommand: new (input: unknown) => unknown;
  DeleteObjectCommand: new (input: unknown) => unknown;
  CreateMultipartUploadCommand: new (input: unknown) => unknown;
  UploadPartCommand: new (input: unknown) => unknown;
  CompleteMultipartUploadCommand: new (input: unknown) => unknown;
  AbortMultipartUploadCommand: new (input: unknown) => unknown;
};
type PresignerModule = {
  getSignedUrl: (client: S3Client, command: unknown, options: unknown) => Promise<string>;
};

let _s3Client: S3Client | null = null;
let _s3Module: S3Module | null = null;
let _presignerModule: PresignerModule | null = null;

async function loadS3(): Promise<{ client: S3Client; mod: S3Module; presigner: PresignerModule } | null> {
  if (_s3Client && _s3Module && _presignerModule) {
    return { client: _s3Client, mod: _s3Module, presigner: _presignerModule };
  }
  const config = getS3Config();
  if (!config) return null;

  try {
    const s3mod = await import("@aws-sdk/client-s3");
    const presignerMod = await import("@aws-sdk/s3-request-presigner");
    _s3Module = s3mod as unknown as S3Module;
    _presignerModule = presignerMod as unknown as PresignerModule;
    _s3Client = new _s3Module.S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
    return { client: _s3Client, mod: _s3Module, presigner: _presignerModule };
  } catch {
    console.warn("[storage] @aws-sdk/client-s3 not installed - S3 operations unavailable");
    return null;
  }
}

/** Upload a file to S3. */
export async function uploadToS3(
  key: string,
  data: Buffer | Uint8Array
): Promise<{ key: string; url: string; size: number }> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const buffer = data instanceof Buffer ? data : Buffer.from(data);
  await loaded.client.send(
    new loaded.mod.PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentLength: buffer.byteLength,
    })
  );

  return {
    key,
    url: `${config.publicUrl}/${key}`,
    size: buffer.byteLength,
  };
}

/** Download a file from S3. */
export async function downloadFromS3(key: string): Promise<Buffer> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const res = await loaded.client.send(
    new loaded.mod.GetObjectCommand({ Bucket: config.bucket, Key: key })
  ) as { Body?: { transformToByteArray: () => Promise<Uint8Array> } };

  if (!res.Body) throw new Error("S3 download: empty body");
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/** Delete a file from S3. */
export async function deleteFromS3(key: string): Promise<void> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  await loaded.client.send(
    new loaded.mod.DeleteObjectCommand({ Bucket: config.bucket, Key: key })
  );
}

/**
 * Generate a presigned URL for direct browser upload (bypasses the server).
 * The browser PUTs the file directly to S3 using this URL.
 */
export async function getPresignedUploadUrl(
  filename: string,
  expiresIn = 600
): Promise<{ url: string; key: string; method: "PUT" }> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const key = `${randomUUID()}${ext}`;
  const command = new loaded.mod.PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
  });
  const url = await loaded.presigner.getSignedUrl(loaded.client, command, {
    expiresIn,
  });
  return { url, key, method: "PUT" as const };
}

/** Generate a presigned URL for temporary read access. */
export async function getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const command = new loaded.mod.GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  });
  return loaded.presigner.getSignedUrl(loaded.client, command, { expiresIn });
}


// ── Multipart upload (for large file chunked upload) ─────────────────────

/** Initiate a multipart upload. Returns the S3 upload ID. */
export async function createMultipartUpload(
  key: string
): Promise<string> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const res = await loaded.client.send(
    new loaded.mod.CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
    })
  ) as { UploadId?: string };

  if (!res.UploadId) throw new Error("S3 CreateMultipartUpload: no UploadId");
  return res.UploadId;
}

/** Upload a single part. Returns the ETag for later completion. */
export async function uploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  data: Buffer | Uint8Array
): Promise<string> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const buffer = data instanceof Buffer ? data : Buffer.from(data);
  const res = await loaded.client.send(
    new loaded.mod.UploadPartCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: buffer,
      ContentLength: buffer.byteLength,
    })
  ) as { ETag?: string };

  if (!res.ETag) throw new Error(`S3 UploadPart ${partNumber}: no ETag`);
  return res.ETag;
}

/** Complete a multipart upload by providing all part ETags. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<string> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  const res = await loaded.client.send(
    new loaded.mod.CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  ) as { Location?: string };

  return res.Location ?? `${config.publicUrl}/${key}`;
}

/** Abort a multipart upload (cleans up uploaded parts on S3). */
export async function abortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
  const loaded = await loadS3();
  const config = getS3Config();
  if (!loaded || !config) throw new Error("S3 not configured");

  await loaded.client.send(
    new loaded.mod.AbortMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
    })
  );
}
