# 拆分线合并前等价矩阵（2026-11-20）

- 目的：在删除 Java/Python 拆分栈前，逐域确认主线（Vue + Next API + TS worker + Prisma）是否已有等价能力。
- 方法：只读代码与配置核对；未启动拆分栈，未做运行时流量验证。
- 判定：**A** 主线已有等价行为；**B** 主线缺失需移植；**C** 拆分线独有但可丢弃；**D** 无法静态判断。

## 1. 能力矩阵

| 能力域 | 拆分线实现 | 主线实现 | 判定 |
|---|---|---|---|
| 认证 / 2FA / JWT | `services/business/.../auth/{AuthController,TwoFactorController,JwtAuthFilter,JtiRevocationService,ApiKeyService}.java` | `src/app/api/auth/**`、`src/lib/auth/{session,jti-shared,guard}.ts`、`src/lib/security/{store,totp}.ts` | **A**：主线多出注册、登出、邮箱验证、OAuth、备用码、preAuth 强制绑定；TOTP 重放保护已由 `verifyTOTPWithStep` + `lastUsedStep` 实现 |
| 知识库 / 文档上传 | `KbController.java`、`KbWriteController.java`（文本同步索引、binary 202+status） | `src/app/api/knowledge-base/**`、`upload/chunk/**`、`src/lib/kb/store.ts` | **A**：multipart、分片直传、Web 导入、编辑、重索引、图谱、分享、文件回读均为主线独有；Java 的 202 轮询可丢弃 |
| Chat / SSE | `ChatController.java`、`SseFrameParser.java`（透传 Python） | `src/lib/chat/ask.ts`、`src/app/api/chat/**` | **A**：主线含 regenerate、联网搜索、多模态、followUps、error code、会话归属与限流；Java 为子集 |
| Agent 编排 / 任务 | `AgentController.java`、`AgentEventBus.java`、`services/ai/app/agent*.py` | `src/lib/agent/**`、`queue/handlers.ts`、`queue/recovery.ts` | **A**：主线有 4 阶段编排、任务重试/分享/评论/版本、BullMQ stalled 恢复与启动重投；Java 的 worker 心跳/lazy sweep 由 `recoverInterruptedJobs` 覆盖 |
| Webhook | `WebhookService.java`（进程内线程池投递） | `src/lib/webhooks/store.ts`、`queue/handlers.ts`、`src/app/api/v1/webhooks/**` | **A**：HMAC 头与 `sha256=<hex>` 一致；主线有 CRUD、队列重试/DLQ、SSRF 复检 |
| 计费 / 配额 | `UsageService.java`（只写用量） | `src/lib/billing/**`、`src/app/api/billing/**` | **A**：主线含套餐、支付、订单、取消、webhook；Java 仅计量子集，可丢弃 |
| 限流 | `RateLimitFilter.java` + `RateLimiter.java`（3 维） | `src/proxy.ts`、`src/lib/rate-limit.ts`（7 维） | **A**：主线多出 API Key、Agent、集成、认证邮件维度 |
| 审计 | `AuditService.java`（链式写入） | `src/lib/security/audit.ts`、`admin|team/audit` 路由 | **A**：主线含链校验、保留期、查询端点 |
| 文件存储 | Java 无 S3 客户端，仅 base64 内联 | `src/lib/storage/**`、`upload/chunk/**`、`files/[key]` | **A**：主线 S3/本地、预签名、清理、分片为主路径 |
| 通知 / 团队 | `TeamMemberController.java`（无 workspace 过滤、无邀请/通知） | `src/app/api/team/**`、`notifications/**`、`src/lib/team/**` | **A**：主线有邀请闭环、活动流、通知 SSE、租户过滤 |
| 协同编辑 | 无 | `src/lib/collab/**`、Yjs 同步路由 | **C**：拆分线无对应物 |
| 搜索 / RAG | Python `retrieval/bm25/embeddings/store.py`（进程内向量） | `src/lib/rag/**`、`api/search`、`graph/search` | **A**：主线含 rerank、query rewrite、持久化向量后端、全局搜索；Python 重启即失 |

## 2. Schema 对账

- Prisma：**26** 个迁移（`prisma/migrations/`）。
- Flyway：**21** 个迁移（`services/business/src/main/resources/db/migration/`）。
- V1–V17 为 Prisma 历史迁移的逐字收编；V18–V21 对应 `user_security_state`、`api_key_expiry`、`usage_daily`、`user_usage_daily`。
- Flyway 缺少的 5 个 Prisma 迁移：
  - `20261030120000_document_access`（`KbDocument.access`）
  - `20261102120000_notification_team_activity`（`NotificationPrefs.teamActivity`）
  - `20261103120000_team_invite_reservation`（`TeamInviteReservation`）
  - `20261104120000_document_version`（`version` / `editedBy`）
  - `20261119120000_tenant_indexes_owner_cascade`（租户索引 + `KnowledgeBase.owner` 级联）

**结论：** Prisma 是唯一完整 schema 来源；Flyway 已落后。删除 Flyway 前需确认生产库的 `flyway_schema_history` 仅作历史记录，并保留数据库备份。

## 3. 运行时引用

- `AI_SERVICE_URL` / `AI_INTERNAL_TOKEN`：仅 `src/lib/rag/remote.ts`、`src/lib/chat/ask.ts`、`src/lib/queue/handlers.ts`、`src/lib/kb/store.ts`、`src/lib/config.ts` 及对应测试；默认值为空。
- `services/business` / `services/ai`：仅 `docker-compose.split*.yml`、`deploy/`、文档引用；主线 `src/` 无 Java 调用。
- Flyway：仅 `docker-compose.split.yml` 注释与 `application-pg.yml`；CI 无 Flyway/Java job。
- `ai-contract`：仅运行 `services/ai/tests`。
- `test-sdk` 的 `python3` 是 SDK 运行时依赖，不是 AI 服务依赖，删除 `services/ai` 不影响。

## 4. 需要移植（阶段 2）

| 项 | 原因 | 决策 |
|---|---|---|
| Agent SSE 服务端 watchdog + 25s `: ping` | Java 在 300s 无帧时发 `error(stream_timeout)+end` 并保活；主线仅监听客户端 abort，worker 静默会永久挂住 | **移植到 `src/lib/agent/run-handler.ts`**，复用 `AGENT_STREAM_TIMEOUT_SECONDS`（默认 300） |
| TOTP 重放保护 | 已由 `verifyTOTPWithStep` + `lastUsedStep` 实现 | 无需移植 |
| Agent worker 心跳 / lazy sweep | 主线 `recoverInterruptedJobs` + BullMQ stalled 已覆盖 | 无需移植 |
| Cookie Secure | 主线生产环境硬编码 `secure` | 无需移植 |
| Webhook 验签 | 两侧 `sha256=<hex>` 与四个头一致 | 无需移植 |
| K8s 探针 | 主线 `src/app/api/health*` 已含 db/redis/llm/queue/revocation | 无需移植；`k8s/` 仅示例 |

## 5. 阶段 3 删除清单

1. 部署入口：`docker-compose.split.yml`、`docker-compose.split.drill.yml`、`deploy/nginx.conf` 的 split 段、`deploy/nginx/frontend-switch.conf`（若不再切流）、`k8s/split.yaml`、`deploy/env.split.example`、`deploy/moto.Dockerfile`、`scripts/deploy/clean-machine-drill.sh` split 段。
2. Java：`services/business/**`。
3. Python：`services/ai/**`、CI `ai-contract` job。
4. Flyway：`services/business/src/main/resources/db/migration/**`。
5. 主线残留：`src/lib/rag/remote.ts`、`kb/store.ts` 的 `processDocInQueueRemote`、`chat/ask.ts` 与 `queue/handlers.ts` 的 remote 分支、`config.ts` 的 `ai-service` 条目、相关测试与 `.env.example` / `docs/ops/env-vars.md` 变量。
6. 文档：`docs/architecture/service-split*.md` 标历史；ADR-0008/0009 标 Superseded；README/部署手册更新。

## 6. 未验证 / 风险

- 未连接真实生产库核对 `flyway_schema_history` 与 Prisma `_prisma_migrations` 的基线。
- 未执行真实网关切流；删除部署入口前需确认生产入口已不指向 Java。
- Java/Python 的运行时行为（限流、SSE、审计链字段）只做静态对照，未做流量对拍。

## 7. 执行结果（2026-11-20）

- 阶段 1/2：Agent SSE 25s 保活与 `AGENT_STREAM_TIMEOUT_SECONDS` 硬超时已收编到 `src/lib/agent/run-handler.ts`，PR #116。
- 阶段 3：`services/business`、`services/ai`、Flyway、split compose、`k8s/split.yaml`、nginx 切流脚本与远程 AI 适配器已删除，PR #117。
- 环境变量由 85 收敛到 76；`ai-contract` job 保留为退役守卫。
- 部署形态改为 Vue 静态 + Next API；ADR-0010 记录决策，ADR-0008/0009 标记 superseded。
