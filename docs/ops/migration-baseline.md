---
title: 数据库迁移基线核对（Flyway → Prisma）
description: 拆分线退役后，如何核对历史库的 Flyway/Prisma 迁移记录、补齐 Prisma 基线并验证 schema 无漂移
type: how-to
category: ops
level: L2
version: 1.1.0
authors:
  - tech-lead
owner: devops-owner
reviewed_at: 2026-11-26
review_interval: 180
status: published
applies_to: ">=1.4.0"
related:
  - deployment-guide.md
  - env-vars.md
  - ../architecture/adr/adr-0010-single-runtime-consolidation.md
---

# 数据库迁移基线核对（Flyway → Prisma）

2026-11-20 起 Flyway 与 Java 业务服务已删除，**Prisma 是唯一迁移来源**。历史库可能仍处于以下三种状态，部署前必须先核对。

## 1. 只读审计

```bash
# 默认复用 DATABASE_URL；生产建议设置只读连接
BASELINE_DATABASE_URL='postgresql://readonly@host/db' pnpm db:baseline

# 机器可读输出
pnpm db:baseline --json
```

无 `DATABASE_URL` / `BASELINE_DATABASE_URL` 时打印 `SKIP` 并退出 0（与 `verify:migrations` 同一约定）。

报告包含：

- `_prisma_migrations` 是否存在，已应用/待应用/失败迁移；
- `flyway_schema_history` 是否存在，版本与失败记录；
- Flyway 版本到 Prisma 迁移目录的映射缺口；
- `prisma migrate diff` 是否仍有 schema 漂移。仅剩运行期表（`flyway_schema_history`、`kb_chunks`）的差异会显示为 `drift: none（忽略运行期表）`，不阻断基线完成。

## 2. 判定与处理

| 数据库状态 | 处理 |
|---|---|
| 有 `_prisma_migrations`，无待应用 | 无需基线；按 `prisma migrate deploy` 正常升级 |
| 有 `_prisma_migrations`，有 pending | `npx prisma migrate deploy` |
| 只有 `flyway_schema_history`（历史 Flyway 库） | 先备份，再按下方基线步骤补 Prisma 记录 |
| 两个历史表都没有（空库） | 直接 `npx prisma migrate deploy` |
| 两个历史表都有 | 人工比对；不要自动 resolve，先确认 Prisma 是否已完整 |

**基线步骤（只有 Flyway 历史时）**：

```bash
# 1. 备份（必须）
pg_dump -Fc "$DATABASE_URL" > backup-before-prisma-baseline.dump

# 2. 预览将执行的操作（只读）
pnpm db:baseline

# 3. 显式允许写入后执行：
#    对 Flyway 已覆盖的 21 个 Prisma 迁移 resolve --applied，
#    再 migrate deploy 应用剩余 5 个（document_access / notification_team_activity /
#    team_invite_reservation / document_version / tenant_indexes_owner_cascade）
BASELINE_APPLY=1 pnpm db:baseline --apply

# 4. 复核
pnpm db:baseline
npx prisma migrate status
```

脚本拒绝在已有 `_prisma_migrations` 时自动 resolve；也拒绝含失败 Flyway 记录或未映射版本的库。

## 3. Flyway → Prisma 映射

| Flyway | Prisma 迁移 |
|---|---|
| V1 | `20260713022119_init` |
| V2 | `20260804180000_p2_3_report_enhance` |
| V3 | `20260805080000_p3_1_2fa_enforce` |
| V4 | `20260810090000_p3_4_audit` |
| V5 | `20260811000000_p5_3_conversation_feedback` |
| V6 | `20260811010000_p5_4_user_locale` |
| V7 | `20260811120000_p5_5_workspace_brand_color` |
| V8 | `20260812090000_p7_1_webhook_subscriptions` |
| V9 | `20260812100000_p7_2_bot_integrations` |
| V10 | `20260812110000_p7_3_knowledge_graph` |
| V11 | `20260813090000_p3_2_oauth_links` |
| V12 | `20260814045956_agent_task_extended` |
| V13 | `20260816100000_drop_dead_tables` |
| V14 | `20260820230000_m7_kb_member_roles` |
| V15 | `20260828090000_password_reset` |
| V16 | `20260828100000_email_verification` |
| V17 | `20260930120000_tenant_persistence` |
| V18 | `20261019140000_usage_daily` |
| V19 | `20261019120000_user_security_state` |
| V20 | `20261019130000_api_key_expiry` |
| V21 | `20261019150000_user_usage_daily` |

剩余 5 个仅为 Prisma 迁移：`document_access`、`notification_team_activity`、`team_invite_reservation`、`document_version`、`tenant_indexes_owner_cascade`。

## 4. 回滚

- 基线只写 `_prisma_migrations` 历史，不改业务表；回滚用备份恢复数据库。
- **不要删除 `flyway_schema_history`**：保留它作为审计记录，应用不再读取。
- 若 `migrate deploy` 中途失败，先修 SQL 或用备份恢复，不要手工改 `_prisma_migrations` 的 checksum。

## 5. 已验证场景（2026-11-21）

- 全新 Prisma 库重放 26 个迁移：`_prisma_migrations` 26 applied、`drift: none`。
- 模拟 Flyway V1–V21 历史库（仅前 21 个迁移 + `flyway_schema_history`）：识别 21 条映射、拒绝直接 deploy；`--apply` 后补齐 5 个迁移，26 applied、`drift: none`（忽略历史表）。
- 本地 `knowledgeai` 库补齐 5 个迁移后：26 applied、`prisma migrate status` 为 up to date；`kb_chunks` 保留 25 行，`test:db` 4/4 通过。
- 已有 `_prisma_migrations` 的库再执行 `--apply`：按预期拒绝，退出码 1。

> `kb_chunks` 是 `src/lib/rag/vector-index-pgvector.ts` 在运行时创建的 pgvector 表，**不是历史垃圾表**，不要用 Prisma 迁移删除或重建它。

## 6. 与 CI 的关系

CI `quality` job 已包含：

- `prisma migrate diff --exit-code`（schema 与迁移漂移）；
- `pnpm verify:migrations`（空库全量重放 + 破坏性语句扫描）；
- `pnpm test:db`（真实 PostgreSQL 语义测试）。

本脚本面向**已有历史库**，不进入 CI 日常路径；无库时 SKIP。

`pnpm db:baseline` 会为每个库打印一行退役判定：无 `flyway_schema_history` 时写 `退役判定: 本库无 Flyway 历史 -> 不需要基线`。**所有已部署库都报这一行之后**，`db:baseline`、`scripts/db/audit-migration-baseline.ts` 与本页的第 2–4 节才可删除；在此之前删掉它会让 Flyway 时代的库无法收编。

## 7. 旧数据兼容分支的退役判定

`src/lib` 里有几段代码只为兼容迁移前的数据行而存在，删不删取决于**数据**，不取决于仓库。用只读脚本判定：

```bash
# 默认复用 DATABASE_URL；生产建议只读连接
BASELINE_DATABASE_URL='postgresql://readonly@host/db' pnpm db:audit-legacy

# 机器可读
pnpm db:audit-legacy --json
```

无库时打印 `SKIP` 并退出 0。脚本只执行 `count(*)`，不写任何表。

| 检查项 | 判定为 0 后可以做的改动 |
| --- | --- |
| `User.passwordHash` 非 `pbkdf2$` 前缀（旧无盐 SHA-256） | 删除 `auth/store.ts` 的 `legacyHash` / `passwordMatches` 旧分支；`seed()` 需同时改为写 PBKDF2（它是同步函数，要改成异步或预生成哈希） |
| `ApiKey.keyHash` 非 `sha256$` 前缀（AES 密文或 pre-P3-4 明文） | 删除 `apikeys/store.ts` 的 `storedSecretOf` / 明文比较分支 |
| `User.plan` 不为 `free`（`@deprecated` 列） | 生成一个删除该列的迁移；读取路径已全部走 `Workspace.plan` |
| `ApiKey.expiresAt` 为 NULL 的 active 行（信息项） | 不阻塞删除；用于安排密钥轮换回填 |

判定顺序建议：先删代码再清理数据是无法回滚的方向，所以**先跑审计、先迁移数据，再删代码**。

## 8. 修订记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 1.0.0 | 2026-11-21 | 初版：Flyway→Prisma 基线核对、映射表与已验证场景 |
| 1.1.0 | 2026-11-26 | 补退役判定：`db:baseline` 的自退役条件；新增第 7 节（`pnpm db:audit-legacy` 与旧数据兼容分支的删除条件） |
