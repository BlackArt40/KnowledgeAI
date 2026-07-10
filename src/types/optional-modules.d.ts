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
