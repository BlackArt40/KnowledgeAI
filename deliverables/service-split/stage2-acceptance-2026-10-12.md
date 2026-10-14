# 阶段二验收报告：对象存储替代共享磁盘

> 依据 [服务拆分实施手册](../../docs/architecture/service-split.md) 阶段 2 的验收标准（A2.1～A2.7）逐项记录。
> AI 辅助执行与编写，结果由实际运行产出。

| | |
|---|---|
| 日期 | 2026-10-12 |
| 验收对象 | 上传链路接 S3、`/internal/index` 源收敛、删除清理、compose minio |
| 验证环境 | 本机（macOS / Python 3.14 / Node 22）；S3 兼容服务为 **moto server**（真实 S3 REST 语义，见「环境限制」）；`pnpm dev` 内存演示模式 |
| 开关 | `AI_SERVICE_URL` + `AI_INTERNAL_TOKEN` + `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY`（仅验证进程环境） |

## 一、交付物

| 工作包 | 文件 | 说明 |
|---|---|---|
| 2.1 存储配置 | `docker-compose.yml`、`.env.example`、`docs/ops/env-vars.md` | compose 新增 `minio`（9000 API / 9001 控制台）+ `minio-init`（建私有 bucket）；ai 服务注入 `S3_*`；env 双侧同步 |
| 2.2 上传链路 | `src/lib/storage/index.ts`、`upload/route.ts`、`upload/chunk/[uploadId]/complete/route.ts`、`storage/s3.ts` | `docStorageKey()` 确定性 key（`<kbId>/<docId>-<safeName>`，与本地命名一致，删除无需持久化 objectKey）；`saveDocFile()`（S3 或本地回退）；主上传路由改走存储抽象；分片 complete 后 `copyS3Object` 把 pending 对象改名到 docStorageKey |
| 2.3 索引入参 | `services/ai/app/main.py`、`src/lib/rag/remote.ts`、`src/lib/kb/store.ts` | Python `source.type` 收敛为 `presignedUrl` / `s3` / `content`，**file:// 显式拒绝**（报错并提示替代）；TS 远端路径二进制文档 → 预签名 GET（TTL 600s）；`s3` 源由 Python 侧 boto3 凭据拉取 |
| 2.4 权限 | `getPresignedDownloadUrl(key, 600)` | 预签名 TTL 600s ≤ 15 分钟上限；bucket 私有；SSRF 放行面收窄为「已配置的 S3 端点主机」或 `AI_ALLOW_PRIVATE_FETCH` |
| 2.5 清理 | `src/lib/kb/store.ts`（deleteDocument / deleteKb）、queue `index-cleanup` | 删文档：业务侧 `deleteDocFile`（S3 对象或本地文件）+ `index-cleanup` 入队（AI 开启 → 远端 DELETE；单体 → 进程内清除）；删 KB：逐文档删对象 + 整库远端清理。**顺带修复了 index-cleanup 有 handler 无生产者的存量缺口** |
| 2.6 下线共享卷 | `docker-compose.yml` | ai 服务不再挂载 uploads 卷、不再有 `AI_UPLOADS_DIR`；app/worker 保留本地卷仅为单体回退模式 |
| 2.7 备份说明 | `docs/ops/runbook.md`（RB-02 增补） | 「知识库完整恢复 = Postgres + bucket 缺一不可」+ mc mirror 备份/恢复命令 + 发布前验收项 |
| 测试 | `services/ai/tests/test_contract.py` | 新增 6 条：file:// 拒绝、presignedUrl 拉取/过期 403/私网 SSRF 拒绝、s3 源 boto3 拉取/缺 key/未配置 |

## 二、验收标准逐项记录

| 编号 | 标准 | 结果 | 证据 |
|------|------|:----:|------|
| A2.1 | 分片上传完成后对象可见（≥5MB） | ✅ | 5.58MB JSON 经 init → 2×chunk → complete 上传，`doc` 创建；boto3 `list_objects_v2` 确认对象位于 `kb_f8fd36954d00/doc_3a8c6de0d320-stage2-test.json`（docStorageKey 派生） |
| A2.2 | AI 服务无共享卷仍能索引成功 | ✅ | ai 服务无 uploads 挂载、file:// 已从协议层移除；文档 content 为空 → Python 经预签名 GET 从对象存储拉取并解析 → `ready`，chunks=4661；问答引用 4 条指向该文档（答案含对象原文） |
| A2.3 | 对象不可公网匿名下载 | ✅ | 对已存在对象发起匿名 GET → **403**（bucket 私有，无匿名策略） |
| A2.4 | 预签名过期后 GET 失败 | ⚠️ 见限制 | 代码审计：TTL 600s ≤ 900s 上限；服务侧 403 → `fetch_error` 已由 `test_presigned_url_expired_403` 锁定。moto 不校验签名时效（T+6s 仍 200），**过期 403 需在真实 MinIO 环境复核** |
| A2.5 | 删除文档后对象与向量均不存在 | ✅ | `DELETE /api/knowledge-base/{id}/documents/{docId}` → 桶内对象消失（`list_objects_v2` 为空）+ 远端 `/internal/retrieve` 0 hits（index-cleanup → 远端 DELETE）；`DELETE kb` 同时验证整库清理 |
| A2.6 | 未配 S3 时本地回退仍可用 | ✅ | `saveDocFile` 本地分支保留（`.uploads/<kbId>/<docId>-<name>`）；无开关单体模式 `pnpm test:e2e` **10/10 passed**（2.1m，含登录→上传→问答→Agent） |
| A2.7 | 备份说明 | ✅ | runbook RB-02「对象存储」小节：备份/恢复命令、缺一不可语义、发布前验收项 |

**本地门禁**：`npx tsc --noEmit` 零错误；`pnpm lint` exit 0；`pnpm test:unit` exit 0（lines 80.62% / branches 67.26%）；`pytest services/ai/tests -q` **21/21 passed**；`pnpm test:e2e` **10/10 passed**。

## 三、契约精化（相对手册阶段 2 原文）

1. **保留 `content` 源类型**：text-like 文档（v1 端点 / 队列内已提取文本）以内联文本索引，避免对象往返；手册 2.3 的「只允许 s3/presignedUrl」针对的是**文件**——G4「对象存储为文件唯一来源」指文件，无文件实体（网页链接除外）的文本文档不涉及。
2. **file:// 显式下线**：不再静默兼容，Python 返回 `invalid_request` 并提示三种替代源（契约测试锁定）。
3. **确定性对象 key**：`<kbId>/<docId>-<safeName>`，分片上传完成后服务端改名（CopyObject）——删除路径无需在 Prisma schema 增加 objectKey 列（避免一次迁移），对象归属可审计。
4. **index-cleanup 补全生产者**：手册 2.5 假定该任务已接线，实际此前只有 handler 无入队方（存量缺口），本次在删除链路接上。

## 四、环境限制（不阻塞退出，复核项）

| 项 | 说明 | 复核方式 |
|---|---|---|
| 本机无法拉取 MinIO 镜像 | `minio/minio` 直连被拒、5 个国内镜像源均不可用/损坏层/需授权，MinIO 亦已停止发布 macOS Intel 官方二进制（410） | 在可访问 Docker Registry 的环境跑 `docker compose up -d minio minio-init` 复核 A2.1 控制台可见性 |
| A2.4 过期 403 未在本机复核 | moto server 不校验 SigV4 时效（对合法签名永不过期）；语义已由 pytest（403 → `fetch_error`）+ 代码 TTL 审计覆盖 | 同上：MinIO 环境中生成 TTL=5s 预签名，T+6s 期望 403 |
| moto 与 MinIO 的差异 | moto 提供 S3 REST/签名/私有桶语义（A2.3 匿名 403 为忠实行为）；分片 multipart 语义亦经真实 @aws-sdk 客户端验证 | — |

## 五、回滚方式

- 对象存储回退：`S3_*` 置空 → 上传/删除回到本地 `.uploads`（`saveDocFile` 双模式），e2e 已验证该模式全绿（A2.6）。
- AI 服务回退：`AI_SERVICE_URL` 置空 → 队列与 chat 回到进程内 TS RAG（阶段 1 同一开关）。
- compose 的 minio/minio-init 服务不依赖其它服务，可单独停掉。

## 六、建议的下一步（阶段 3 入口）

1. AI 侧租户硬化收尾：pgvector 后端（compose 已有 pgvector 实例）、负例套件入 CI（阶段 1 已提前落底大部分）；
2. 真实 MinIO 环境复核 A2.4 + A2.1 控制台可见性（一次性演练）；
3. 阶段 4（拆业务服务）开工前先写语言选择 ADR（手册已要求）。
