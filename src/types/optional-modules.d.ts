// ---------------------------------------------------------------------------
// Type declarations for optional production dependencies.
// These packages are dynamically imported (not installed in demo mode):
//   - @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (S3 storage)
//   - bullmq + ioredis (Redis task queue)
//   - @prisma/client (PostgreSQL ORM)
//
// When installed, the real type declarations supersede these stubs.
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

declare module "bullmq" {
  export class Queue {
    constructor(name: string, opts?: unknown);
    add(name: string, data: unknown, opts?: unknown): Promise<unknown>;
    getJob(id: string): Promise<unknown>;
    getJobState?(id: string): Promise<string>;
    close(): Promise<void>;
  }
  export class Worker {
    constructor(
      name: string,
      processor: (job: unknown) => Promise<unknown>,
      opts?: unknown
    );
    on(event: string, cb: (...args: unknown[]) => void): void;
    close(): Promise<void>;
  }
}

// ── Document parser optional dependencies ────────────────────────────────

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

declare module "mammoth" {
  export function extractRawText(opts: {
    buffer: Buffer;
  }): Promise<{ value: string; messages: unknown[] }>;
  export function convertToHtml(opts: {
    buffer: Buffer;
  }): Promise<{ value: string; messages: unknown[] }>;
}

declare module "xlsx" {
  export interface WorkSheet { [cell: string]: unknown; "!ref"?: string }
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export function read(buf: Buffer, opts: unknown): WorkBook;
  export const utils: {
    sheet_to_csv(sheet: WorkSheet): string;
    sheet_to_json(sheet: WorkSheet): unknown[];
  };
}

// ── Redis client (for distributed rate limiting) ─────────────────────────

declare module "ioredis" {
  export default class Redis {
    constructor(url: string, opts?: unknown);
    eval(
      script: string,
      keys: number,
      ...args: (string | number)[]
    ): Promise<number[]>;
    zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
    zcard(key: string): Promise<number>;
    zadd(key: string, score: number, member: string): Promise<number>;
    pexpire(key: string, ms: number): Promise<number>;
    quit(): Promise<void>;
  }
}
