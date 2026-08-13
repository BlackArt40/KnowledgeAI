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

// pdf-parse ships no type declarations (plain JS package, no @types either),
// so a minimal ambient module stays - the parser casts the result itself.
declare module "pdf-parse" {
  interface PdfData {
    text: string;
    numpages?: number;
    info?: { Title?: string };
  }
  const pdfParse: ((buf: Buffer) => Promise<PdfData>) & {
    default?: (buf: Buffer) => Promise<PdfData>;
  };
  export default pdfParse;
}
