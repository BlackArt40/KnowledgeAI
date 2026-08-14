-- AlterTable: backfill updatedAt for existing rows (Prisma's @updatedAt
-- requires a value; the column cannot be NOT NULL without a default).
ALTER TABLE "AgentTask" ADD COLUMN     "agents" JSONB,
ADD COLUMN     "kbName" TEXT,
ADD COLUMN     "maxSteps" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "template" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "workspaceId" TEXT NOT NULL DEFAULT 'ws_default';

ALTER TABLE "AgentTask" ALTER COLUMN "updatedAt" DROP DEFAULT;
