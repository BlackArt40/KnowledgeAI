-- P3：文档正文应用内编辑（乐观并发 + 最后编辑人）。
-- 旧行默认 version=1，作为第一次编辑的 baseVersion。
ALTER TABLE "KbDocument" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "KbDocument" ADD COLUMN "editedBy" TEXT;
