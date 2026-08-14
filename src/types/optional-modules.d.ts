// ---------------------------------------------------------------------------
// Type declarations for optional production dependencies.
// These packages are dynamically imported and NOT installed:
//   - @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (S3 storage)
//
// P6-4: the stubs for bullmq / ioredis / pdf-parse / mammoth / xlsx were
// removed - they are real dependencies now (package.json + serverExternal
// Packages) and their real type declarations must apply. An ambient
// `declare module` SHADOWS the package's own types, so keeping the stubs
// blocked the real APIs (e.g. ioredis Redis#connect).
//
// 2026-08-14 tech-stack review: pdf-parse dropped entirely - PDF text
// extraction now uses pdfjs-dist (real dependency, ships its own types).
// `stripe` is a real dependency too and needs no stub here.
// ---------------------------------------------------------------------------

declare module "@aws-sdk/client-s3" {
  export class S3Client {
    constructor(config: unknown);
    send(command: unknown): Promise<unknown>;
  }
  export class PutObjectCommand {
    constructor(input: unknown);
  }
  export class GetObjectCommand {
    constructor(input: unknown);
  }
  export class DeleteObjectCommand {
    constructor(input: unknown);
  }
}

declare module "@aws-sdk/s3-request-presigner" {
  export function getSignedUrl(
    client: unknown,
    command: unknown,
    options: unknown
  ): Promise<string>;
}
