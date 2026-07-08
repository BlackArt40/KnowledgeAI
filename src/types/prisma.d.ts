// Type stub for the optional @prisma/client dependency.
// This allows type-checking to pass when Prisma is not installed.
// In production: pnpm add @prisma/client && npx prisma generate
declare module "@prisma/client" {
  export class PrismaClient {
    constructor(options?: Record<string, unknown>);
    [key: string]: unknown;
  }
}
