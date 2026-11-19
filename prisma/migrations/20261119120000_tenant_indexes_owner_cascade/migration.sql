-- P1（2026-11-19 审查）：高频表索引补齐。
-- 会话加载按 conversationId、会话列表按租户+用户、Agent worker 按租户+状态
-- 轮询、KB 列表按租户过滤，此前这些列全无索引（KbDocument/KbChunk 早有同等
-- 索引，属遗漏而非策略）。10^5 行级别起退化为顺序扫描，级联删除同样变慢。
CREATE INDEX "KnowledgeBase_workspaceId_idx" ON "KnowledgeBase"("workspaceId");
CREATE INDEX "Conversation_workspaceId_userId_idx" ON "Conversation"("workspaceId", "userId");
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX "AgentTask_workspaceId_status_idx" ON "AgentTask"("workspaceId", "status");

-- P1：KB 所有者关系显式级联。
-- schema 此前未声明 onDelete，Prisma 对必选关系落成 ON DELETE RESTRICT：
-- 账号名下只要还有 KB，删号就会在 DB 层失败。KB 属于其所有者，改为 CASCADE
-- （自助注销路径已先逐库删除，此约束只作为 DB 侧兜底）。
ALTER TABLE "KnowledgeBase" DROP CONSTRAINT "KnowledgeBase_ownerId_fkey";
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
