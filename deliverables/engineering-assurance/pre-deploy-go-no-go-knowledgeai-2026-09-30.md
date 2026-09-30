# KnowledgeAI (KAI) 部署前检查报告（Go / No-Go）

**日期**：2026-09-30
**工作流**：工作流 4（部署前检查）
**参与成员**：Rex（SRE 工程师，检查清单与回滚方案）、Cody（代码审查师，安全风险）、Tessa（测试专家，CI / 测试状态）
**目标版本**：`main` @ `3efff59`（CI #91，9/9 checks success，无 git tag）
**部署形态**：蓝绿（`deploy-prod.yml` → GHCR → 远程服务器 `blue-green.sh` 接管 `:3000`）；staging 由 `deploy.yml` 在 push main 时触发

---

## 📌 TL;DR（执行摘要）

- 整体结论：**No-Go（不通过）**。CI 与测试全绿，但存在 **4 项安全阻塞**（多租户越权 ×2、KB 归属不落库、模型 SSRF）+ **1 项部署配置冲突**（k8s `replicas:2` 与单实例内存设计 + RWO 共用卷），其中若干项**在部署后即触发**。
- 严重度分布：🔴严重 **0** 项 / 🟠高 **6** 项 / 🟡中 **5** 项 / 🟢低 **7** 项（安全项，来自代码审查报告，去重后）
- 阻塞 / 非阻塞：**阻塞 5 项**（4 安全 + 1 部署配置）；非阻塞 18 项
- 结论口径：**"代码质量与工程门禁达标，但多租户隔离与部署配置未达生产标准"**——修复阻塞项后可 Go

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🔴 **不通过（No-Go）** |
| 阻塞项数量 | **5**（4 安全 + 1 部署配置） |
| 关键行动项 | **5 条**（见行动清单） |
| 建议下一步 | 修复多租户隔离簇 + 模型 SSRF + 修正 k8s 清单后重跑检查清单；不建议在当前状态下对外发布 |

---

## ✅ 检查清单逐项打勾（Rex 定制，含验证命令）

> ✅=通过 / ❌=不通过 / ⚪=本次未验证（需目标环境）/ 🔶=本次不适用
> 说明：以下多数命令需在**宿主机/容器内**执行；**经 agent 沙箱的 curl 会返回伪造 502**（务必 `curl --noproxy '*'` 且绕过沙箱）。

### B0 部署前（Pre-flight）
| # | 检查项 | 验证命令 | 预期 | 结果 |
|:--:|--------|---------|------|:--:|
| 1 | CI 质量门全绿 | `gh run list -w ci.yml` | 最新全绿 | ✅（#91 9/9 success） |
| 2 | 迁移漂移 = 0 | `prisma migrate diff ... --exit-code` | exit 0 | ⚪ |
| 3 | 破坏性迁移评审 | `grep -niE "drop (table\|column)\|not null" <新迁移>` | 人工确认 | 🔶 本次无新迁移 |
| 4 | 环境变量 parity | `npx tsx scripts/tools/check-env-parity.ts` | exit 0 | ✅（68 变量一致） |
| 5 | `AUTH_SECRET` 生产合规 | 随机 ≥32 字符，非 `change-me…` | 合规 | ⚪ |
| 6 | 回滚点已登记 | 记录当前镜像 tag + `prisma migrate status` | 已记录 | ⚪ **必须补做** |
| 7 | 镜像可拉取 | `docker pull ghcr.io/<org>/knowledgeai:prod-<tag>` | 成功 | ⚪ |
| **X1** | **app `replicas` 必须 = 1**（内存读路径事实源） | 检查 `k8s/deployment.yaml:37` | =1 或已补持久化 | ❌ **=2，冲突** |
| **X2** | **若多副本：PVC 必须 RWX/对象存储** | 检查 `:24-25` | RWX | ❌ **RWO 被 3 Pod 争用** |
| **X3** | **现清单标注"示例，不可直接用于生产"** | 检查清单头注 | 已标注 | ❌ |

### B0-X1/X2/X3 详情（本次新增硬门）
【实测】`k8s/deployment.yaml`：app `replicas: 2`（:37）、worker `replicas: 1`（:109）；PVC `knowledgeai-uploads` 为 `ReadWriteOnce`/10Gi（:24-28），被 **3 个 Pod 争用**（2 app + 1 worker，挂载 :69/:137，claim :100/:148）。
- `ReadWriteOnce` = **单节点**可读写（非单 Pod）→ **多节点集群开箱即坏**（Multi-Attach → 后到 Pod Pending/CrashLoop）；单节点亦不推荐。
- 叠加"`KB.workspaceId` 不落库 + `Workspace.members` 不写"→ `replicas>1` 会把 KB **静默归并 `ws_default`**、重启丢成员。
- 清单自身注释（:17-18）已自认"多副本建议 RWX 或对象存储"——**配置自相矛盾**。

### B1 依赖服务
| # | 检查项 | 验证命令 | 预期 | 结果 |
|:--:|--------|---------|------|:--:|
| 8 | Postgres 可达 | `pg_isready -h $PGHOST -p 5432` | accepting | ⚪ |
| 9 | pgvector 已装 | `psql ... -c "SELECT 1 FROM pg_extension WHERE extname='vector'"` | 1 行 | ⚪ |
| 10 | Redis 可达 | `redis-cli -u "$REDIS_URL" ping` | PONG | ⚪ |
| 11 | 可选向量库 | `curl -sf $CHROMA_URL/api/v1/heartbeat` | 200 | 🔶 |
| 12 | 迁移已应用 | `npx prisma migrate deploy` | All applied | ⚪ |
| 13 | 依赖启动顺序 | compose `depends_on: service_healthy` | 已配置 | ⚪ |

### B2 部署中（蓝绿）
| # | 检查项 | 预期 | 结果 |
|:--:|--------|------|:--:|
| 14 | 备用端口先起并过健康检查 | `blue-green.sh:38,51` | ⚪ |
| 15 | HEALTHCHECK 通过才接管 `:3000` | `docker inspect ... Health.Status` = healthy | ⚪ |
| 16 | worker 同步部署 | `KAI_WORKER_IMAGE` 起 worker，`Running=true` | ⚪（否则 app 只写队列不消费） |

### B3 部署后（Post-deploy Gate）
| # | 检查项 | 验证命令 | 预期 | 结果 |
|:--:|--------|---------|------|:--:|
| 17 | 存活探针 | `curl -fsS http://127.0.0.1:3000/api/health` | 200 `{status:"ok"}` | ⚪ |
| 18 | 就绪探针 | `curl -s -o /dev/null -w '%{http_code}' .../api/health/ready` | 200（**502/连接拒绝=致命**） | ⚪ |
| 19 | 就绪明细 | `curl -s .../api/health/ready` | db/redis/llm 无 degraded | ⚪ |
| 20 | 队列运行态 | `/admin/monitoring` getQueueStats() | 无异常堆积 | ⚪ |
| 21 | uploads 卷可写 | `docker exec kai-app ls -ld /app/.uploads` | 可写 | ⚪ |
| 22 | 真实链路 smoke | 登录→上传→问答→Agent | 全通 | ⚪ |
| **X4** | **探针盲区**：健康探针**无法感知租户数据被归并** | — | 需独立抽查 KB 归属 | ❌ **能力缺失** |
| **X5** | **队列背压告警**：内存队列无深度上限（配合 1Gi limit → OOMKilled 风险） | — | 有深度/内存告警 | ❌ **缺失** |

### B4 回滚触发条件
| # | 触发条件 | 结果 |
|:--:|---------|:--:|
| 23 | 接管后 60s 内就绪探针非 200 或 5xx/连接拒绝 | ⚪ |
| 24 | 错误率 / P95 延迟较基线显著抬升 | ⚪ |
| 25 | worker 未起或队列积压单调上升 | ⚪ |
| **X6** | **内存持续攀升 / 队列深度单调上升 / 跨租户数据抽查异常** | ❌ **未纳入告警** |

---

## 🔐 安全风险（Cody，阻塞项）

| # | 严重度 | 风险 | 文件:行 | 部署后影响 |
|---|--------|------|---------|-----------|
| S1 | 🟠高 | **模型自定义 `baseUrl` 无 SSRF 校验** | `models/test/route.ts:31` 等 4 处 | 任意登录用户可令服务端探测内网/元数据（`169.254.169.254`），非 2xx 回显响应体前 200 字符 |
| S2 | 🟠高 | **跨租户读**：单文档 GET 漏传 workspace | `documents/[docId]/route.ts:19` | 跨租户可读文档元数据与 content |
| S3 | 🟠高 | **`KB.workspaceId` 不落库** | `schema.prisma:125`；`hydrate.ts:265` | **部署/重启后即触发**：KB 归并 `ws_default`，被默认组织成员可读 |
| S4 | 🟠高 | **多实例鉴权内存态不一致** | `apikeys/store.ts:9-14` 等 | 多副本下 API key/JWT 撤销跨实例失效（**与 X1 叠加**） |
| S5 | 🟠高 | **自助注册落入默认租户** | `workspace/store.ts:79`；`auth/store.ts:177` | 新注册用户可直接读默认组织非私密 KB |

> 另：migrations 含破坏性 `drop_dead_tables` → **禁止部署后直接回滚镜像**（老代码可能引用已删表）。

---

## 🧪 测试覆盖 & CI 状态（Tessa）

| 检查项 | 结果 |
|--------|------|
| GitHub Actions CI（main @3efff59, #91） | ✅ **9/9 success** |
| `npx tsc --noEmit` | ✅ exit 0 |
| `pnpm lint` | ✅ exit 0，0 error / 0 warning |
| `pnpm test:unit`（vitest --coverage） | ✅ 55 files / 382 tests passed（暖跑 8.46s） |
| `pnpm test:smoke --group lib` | ✅ 17 passed / 0 failed |
| e2e 本地 | ⚪【未取得】（以 CI e2e=success 替代） |

**覆盖率（门槛 70/60）**：All files **83.77 / 73.84 / 90.42 / 85.76** ✅；rag / auth / billing / team 四模块**全部达标**。

**但**（影响 Go/No-Go 的风险信号）：
- **高风险路径无单元测试**：`rate-limit.ts`、`ssrf.ts`、`audit.ts`、`apikeys/scopes.ts`、租户边界、`chat/ask.ts`、`agent/orchestrator`、`queue/handlers.ts` —— **恰好是本次 4 项安全阻塞所在模块**。
- **冷启动脆弱**：`pnpm test:unit` 冷跑 `4 failed / 5 超时`（全在 RAG，5s/10s timeout），暖跑全绿 → 环境性，但反映测试超时配置脆弱。
- **覆盖率盲区**：`include` 仅量 4 模块，另有 23 个测试文件不计入 → 真实广度被低估。

---

## 🚦 Go / No-Go 决策

### 决策：🔴 **No-Go**

| 判据 | 结论 |
|------|------|
| CI / 构建 / 类型 / Lint / 单测 | ✅ 达标 |
| 文档门禁（frontmatter / env parity / 死链 / API 漂移） | ✅ 达标 |
| 安全基线（整体） | 🟡 基础好，但 **4 项阻塞未清** |
| 多租户隔离 | 🔴 **不达生产标准**（越权读 + 归属不落库 + 新用户落默认租户） |
| 部署配置 | 🔴 **k8s 清单不可直接用于生产**（`replicas:2` + RWO 争用 + 与内存设计冲突） |
| 可观测性 | 🟡 探针无法发现"租户数据串租"；队列背压无告警 |

**阻止发布的具体理由**：S3（KB 归属不落库）**一经部署即生效**——任何基于该版本的运行都会把 KB 归入 `ws_default`；若同时按清单跑 2 副本，还会叠加静默串租。这不是"理论风险"，而是**部署动作本身触发**。

**转为 Go 的条件（Must-fix 清单）**：
1. 修复 S2（1 行）+ S5 与隔离校验必填化；
2. S3：补 `KnowledgeBase.workspaceId` 迁移并 hydrate 读真实列；
3. S1：模型 `baseUrl` 接入 `resolveSafeUrl`；
4. X1/X2/X3：k8s 清单改 `replicas:1`（或补持久化 + RWX），并标注"示例"；
5. 部署前完成 `pg_dump` 全量备份 + 记录 `prisma migrate status` 回滚点。

> 上述修复约 **7–9 人日**（见技术债报告 阶段 0），完成后建议按本清单**重跑 B0–B4** 再决策。

---

## ↩️ 回滚方案（Rex）

### D1 应用回滚（首选，秒级–分钟级）
- **蓝绿（生产）**：重新触发 `deploy-prod.yml`，input `tag=` 上一成功 tag；`blue-green.sh` 在健康检查失败时**自动回滚**（旧容器继续服务，退出码 1，`blue-green.sh:79-119`）。
- **手动保底**：`docker rename kai-app-old kai-app && docker start kai-app`（旧容器保留）。
- **compose（staging/单机）**：`KAI_IMAGE=<旧tag> docker compose up -d --no-deps app worker`。
- **触发**：B4 任一命中；或接管后就绪探针/错误率回归。

### D2 数据库迁移回滚（高风险，谨慎）
- Prisma **无自动 down 迁移**。优先级：①**前向修复**（写新迁移抵消）> ②从部署前快照/备份恢复（`pg_restore`）> ③`prisma migrate resolve` + 手工 down SQL（**仅限已评审的破坏性迁移**）。
- 部署前**必须**：`pg_dump` 全量备份 + 记录 `migrate status` 作为回滚点。迁移**先于**应用新版执行，且需向下兼容（老代码能读新 schema）。
- **若已执行破坏性迁移**（如 `20260816100000_drop_dead_tables`）→ **禁止直接回滚镜像**（老代码可能引用已删表），只能前向修复或快照恢复。

### D3 交付交付物
- 回滚点登记表（镜像 tag + 迁移版本 + 备份路径）应作为每次发布的前置产出。

---

## ✅ 行动清单

| # | 行动 | 负责角色 | 紧急度 | 预期完成 |
|---|------|---------|--------|---------|
| 1 | 修复 S2 跨租户读 + 隔离校验必填化（1 行级 + 接口收紧） | 后端 owner | **P0** | 3 天内 |
| 2 | 补 `KnowledgeBase.workspaceId` 迁移，hydrate 读真实列（消除"部署即串租"） | 后端 owner | **P0** | 1 周内 |
| 3 | 模型 `baseUrl` 接入 `resolveSafeUrl`（4 处） | 后端 owner | **P0** | 3 天内 |
| 4 | k8s 清单改 `replicas:1`（或补持久化 + RWX）并加"示例"标注 | 运维 owner | **P0** | 3 天内 |
| 5 | 部署前建"备份 + 回滚点登记 + 探针盲区/队列告警"专项（B0-6 / X4 / X5） | 运维 owner | P1 | 下次发布前 |

---

## ⚠️ 待完善 / 已知局限

- **大量检查项为 ⚪ 未验证**：本次在**开发机**执行，无目标生产环境（`PROD_HOST`/Postgres/Redis/GHCR 均未接入），B1–B3 的运行时项需在预发/生产环境补测。
- **沙箱探测陷阱**：本机经沙箱代理的 curl 一律返回**伪造 502**（对死端口亦然）→ 无法据此判定服务健康；真实探测须 `curl --noproxy '*'` 且绕过沙箱。
- **`deploy-prod.yml` 需 GitHub environment 手动审批 + 仓库 secrets**（`PROD_HOST`/`PROD_USER`/`PROD_SSH_KEY`/`PROD_PORT`），本次未触发实际部署。
- **依赖 CVE 未审计**（无 `pnpm audit`）。
- **无 git tag**：仓库尚无正式 release 版本，回滚点登记需从本次开始建立。

---

## 📚 数据来源 & 成员产出索引

- **Rex（SRE 工程师）**：23 项定制检查清单 + B0-X/X1–X6 硬门 + 蓝绿/DB 回滚方案（BLUE-GREEN 脚本行号引用）。
- **Cody（代码审查师）**：4 项发布阻塞安全风险 + 发布前安全审查结论。
- **Tessa（测试专家）**：CI 9/9 success、覆盖率四模块达标、高风险路径测试缺口。
- **主理人独立复核**：`k8s/deployment.yaml`（replicas/RWO/limits）、`ci.yml`（7 job）、`deploy-prod.yml`/`deploy.yml`（部署形态）、无 git tag。

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
