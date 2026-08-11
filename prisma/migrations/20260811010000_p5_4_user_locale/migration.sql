-- P5-4: user UI language preference (persisted across sessions/devices).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'zh-CN';
