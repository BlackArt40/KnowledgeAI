# KnowledgeAI 中危（M 级）缺陷修复记录（2026-08-20）

**依据**：`deliverables/gstack/pre-launch-check-knowledgeai-2026-08-20.md` M 级清单（11 项）
**范围**：M-1 ~ M-10（M-11 payOrder 幂等已在 P1-11 轮完成）
**验证**：`npx tsc --noEmit` ✅ · 单测 307/307 ✅ · `pnpm lint` 0 errors ✅ · `next build` ✅ · `prisma validate` ✅

---

## 修复明细

### M-1 plan 持久化（付费功能误降级）
- `src/lib/db/persist.ts` persistUser：data 补 `plan` 字段（此前丢弃，重启后 hydrateUser 恒为 free）
- `src/lib/db/hydrate.ts` hydrateUser：读 `u.plan`（此前硬编码 "free"）

### M-2 共享 KB 无法跑 Agent
- `src/lib/agent/run-handler.ts`：`kb.ownerId === authUser.id` → `canViewKb(...)`（带 workspace 维度），团队成员可对共享 KB 运行 Agent

### M-3 文档解析阻塞请求线程
- `src/app/api/knowledge-base/[id]/upload/route.ts`：**移除请求线程内的同步 parseDocument**；文件用 `file.stream()` 分块读取（防 OOM，替代一次性 arrayBuffer）；先 `addDocument({skipEnqueue:true})` 建 doc → 存盘（`<docId>-<safeName>`）→ 再 enqueue，杜绝解析竞态
- `src/lib/kb/store.ts`：`addDocument` 加 `skipEnqueue` 选项；`processDocInQueue` 加入**真实 parse**（从 `.uploads/<kbId>/<docId>-*` 读文件 → 文本类 utf-8 / 其他 parseDocument → 设置 content），替换纯模拟 tick
- 注：跨进程 BullMQ worker 需与 web 共享 `.uploads` 卷（docker-compose 挂载说明已注释）

### M-4 队列任务常驻内存
- `src/lib/queue/memory-queue.ts`：`trimJobs()` —— jobs Map 超过 **100** 条时按 createdAt 淘汰最旧终态任务（completed/failed），queued/active 不动

### M-5 限流配置失效
- `src/lib/rate-limit.ts`：新增 `getBaseLimit()` —— 优先读 admin `SystemConfig.rateLimitPerMin`（DB 持久化，运行时修改立即生效）；Edge proxy 读不到 admin store 时回退 env。`getRateLimitLimits().base` 与 `rateLimit()` 默认参数统一走它

### M-6 API key 调用计数重启回退
- `src/lib/apikeys/store.ts`：`logCall` 增加**节流写回**（30s 或每 50 次调用 persist 一次），重启后 counts/lastUsed 不再归零

### M-7 kbMemberRoles 从不落库（权限漂移）
- `prisma/schema.prisma` Team 加 `kbMemberRoles Json @default("{}")`；新增 migration `20260820230000_m7_kb_member_roles`
- `src/lib/db/persist.ts` persistTeam 写 kbMemberRoles；`team/store.ts` 3 处 persistTeam 调用带序列化
- `src/lib/db/hydrate.ts` hydrateTeam 读取并填充 `store.kbMemberRoles`

### M-8 deleteTask 重启后复活
- `src/lib/db/persist.ts` 新增 `deleteAgentTaskFromDb`；`agent/store.ts` deleteTask 同时删 DB 行

### M-9 PPTX zip-bomb → worker OOM
- `src/lib/rag/parser.ts` extractPptxText：按 local header 声明的 compSize 截取压缩数据（不再 inflate 到 buffer 末尾）；`uncompSize > 1MB` 跳过；`zlib.inflateSync(..., { maxOutputLength: 1MB })` 硬上限

### M-10 SSE 断连不取消 LLM 计费
- `src/lib/llm/types.ts` ChatOptions 加 `signal`；`provider.ts` chatStream 传给 `streamText({ abortSignal })`；`generator.ts` generateStream 新增第 6 参透传；`chat/ask.ts` 传入 `req.signal` —— 客户端断开即中止底层 LLM fetch

### M-11（此前完成）Stripe webhook 幂等
- `payOrder` 加 `order.status === "paid"` 短路（P1-11 轮已实现）

---

## 回归验证

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx vitest run` | ✅ 307/307 |
| `pnpm lint` | ✅ 0 errors / 25 存量 warnings |
| `pnpm build` | ✅ 通过 |
| `npx prisma validate` | ✅ schema 有效（M-7 列） |

## 遗留 / 注意

- M-7 引入 schema 变更（Team.kbMemberRoles），CI 的 `prisma migrate diff --exit-code` 会校验 migration 一致性；本地无 Postgres，建议在 CI/预发执行 `prisma migrate deploy` 验证
- M-3 跨进程解析依赖 `.uploads` 共享卷；仅内存模式（单进程 demo）无影响
- 其余 L 级（低）10 项按排期跟进
