-- P5-3: conversation feedback loop + archive/tags grouping.
--   Conversation: persist the P4-1/P4-3 fields that used to be memory-only
--   (shared / workspaceId were lost on restart) + archive & tags columns.
--   Message: like/dislike feedback (feedback/feedbackNote/feedbackAt), used
--   to down-weight a disliked answer's cited documents in later retrievals.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'ws_default';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "feedback" TEXT,
ADD COLUMN "feedbackNote" TEXT,
ADD COLUMN "feedbackAt" TIMESTAMP(3);
