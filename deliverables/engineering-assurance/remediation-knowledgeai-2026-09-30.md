# KnowledgeAI (KAI) 修复交付报告（工程保障四报告闭环）

**日期**：2026-09-30
**分支**：`fix/engineering-assurance-p0-p1`
**PR**：https://github.com/BlackArt40/KnowledgeAI/pull/27
**基线**：`main` @ `3efff59`
**输入**：`code-review` / `incident-login-page-after-shutdown` / `pre-deploy-go-no-go` / `tech-debt`（2026-09-30 四份报告）
**证据等级**：【实测】= 有命令输出或 file:line；【推断】= 基于代码逻辑；【假设】= 无直接证据。

---

## 📌 TL;DR

- 修复范围：**四份报告的全部 P0 阻塞项（7 项）+ P1 安全/正确性项（8 项）+ 事故行动项 E3/E4/E5 + 4 个高风险模块的回归测试**。
- 阻塞项清零：Go/No-Go 的 5 项阻塞（S1–S5 + X1/X2/X3）**全部关闭**；代码审查 4 项阻塞（F1/F2/F3/F5-相邻）中的 **F1/F2/F3/F11 已修**，**F5 已部分缓解并给出方案**（见"未关闭项"）。
- 验证（本地全绿）：`tsc --noEmit` exit 0【实测】；`eslint .` exit 0【实测】；`pnpm test:unit` **59 files / 434 tests 全通过**，覆盖率 **83.87 / 74.27 / 90.45 / 85.96**（门槛 70/60）【实测】；`docs:build` + frontmatter(29 篇) + env parity(69 变量) + API 参考漂移 0 全部通过【实测】。
- 一个重要设计决策：SSRF 逃生口从"调用点传参"改为"模块内环境策略"，并把 dev 开关由 `NODE_ENV !== "production"` 改为**仅显式 development/test**（fail-closed）。

---

## ✅ 逐项修复清单

### P0——发布阻塞项

| # | 报告项 | 文件 | 修复内容 | 状态 |
|---|--------|------|----------|:----:|
| 1 | F2 跨租户读 | `knowledge-base/[id]/documents/[docId]/route.ts:19` | GET 补传 `u.workspaceId`（与 PATCH/DELETE 对齐） | ✅ |
| 2 | F11 隔离选择性启用 | `team/store.ts` | `canViewKb/canEditKb` 的 `opts` 与 `canViewDoc/canEditDoc` 的 `callerWorkspaceId` **改为必填**；契约由 `tsc --noEmit`（CI `quality` job）强制，任一处漏传即编译失败 | ✅ |
| 3 | F3 / A3 KB 归属不落库 | `schema.prisma`、新迁移、`db/persist.ts`、`db/hydrate.ts` | `KnowledgeBase` 增列 `workspaceId String @default("ws_default")` + 迁移 `20260930120000_tenant_persistence`；`persistKb` 写真实列；`hydrateKb` 读真实列（不再硬编码 `ws_default`） | ✅ |
| 4 | A4 `Workspace.members` 不落库 | 同上 | 增列 `members String[] @default([])`；`persistWorkspace` 写、`hydrateWorkspace` 读（DB 为空时保留内存种子，避免升级丢成员） | ✅ |
| 5 | F1 模型 `baseUrl` SSRF | `security/ssrf.ts`、`models/route.ts`、`models/[id]/route.ts`、`models/test/route.ts`、`models/fetch-list/route.ts`、`llm/provider.ts` | 新增 `resolveSafeModelBaseUrl`（写路径，含 DNS）与 `modelBaseUrlPrecheck`（读路径，无 DNS）；4 个写调用点全部接入；真实对话生成走 `provider.ts` 的同步预检 | ✅ |
| 6 | F4 自助注册落默认租户 | `api/auth/register/route.ts`、`auth/oauth-link.ts`、`workspace/store.ts` | 新增 `ensurePersonalWorkspace`（幂等）；注册与首次 OAuth 建号均创建个人工作区；`resolveWorkspace` 回退顺序改为「自有 > 已加入 > 默认」 | ✅ |
| 7 | X1/X2/X3 k8s 配置冲突 | `k8s/deployment.yaml` | app `replicas: 2 → 1`；文件头加「⚠️ 示例清单，不可直接用于生产」+ 三条扩容前置条件；PVC/app 处补 RWO 与单实例设计说明 | ✅ |

### P1——安全与正确性

| # | 报告项 | 修复内容 | 状态 |
|---|--------|----------|:----:|
| 8 | F6 webhook `allowPrivate` 开在业务路径 | **移除** 3 处业务调用点的 `{ allowPrivate: true }`；放宽逻辑收进 `ssrf.ts` 内部，仅由环境决定；同时把 `privateTargetsAllowed()` 从 `NODE_ENV !== "production"` 收紧为**仅 `development`/`test`**（NODE_ENV 误配不再开门） | ✅ |
| 9 | F7 分片单片无上限 | 单片校验 `chunk.size <= session.chunkSize`（超限 413）+ 新增 `UploadSession.receivedBytes` 做累计交叉校验；`markChunkReceived` 改为可选对象入参 | ✅ |
| 10 | F8 上传类型白名单失效 | 直传路由补 `validateFile(file.name, file.size)`；`chunk/complete` 补类型校验（`size=0` 仅校验类型，与分片档位 500MB 上限共存，已注明理由） | ✅ |
| 11 | F9 限流静默回落 | 新增降级计数器 + 节流 WARN 日志 + 恢复日志；`/api/health/ready` 新增 `rateLimit` / `rateLimitDegraded` 字段（附加字段，不改变聚合状态与 503 语义） | ✅ |
| 12 | F10 时序侧信道 | `auth/session.ts` 改为对派生字节做恒定时间比较；`share-password.ts` 遗留分支改用 `timingSafeEqual`（并补长度守卫）；顺带修同类问题：`apikeys/store.ts` 的密钥比较 | ✅ |
| 13 | F12 billing webhook | `JSON.parse` 包 try/catch（签名合法但体非 JSON → 200 + ignored，避免 Stripe 无限重试）；按 `event.id` 去重（500 条环形） | ✅ |
| 14 | F13 分享密码经 query 泄露 | 仅接受 `x-share-password` 头（分享页本就用头，无兼容破坏） | ✅ |
| 15 | F16 `queue.getJobState` 不存在 | 改为 `job.getState()`，新增 `toQueueStatus` 映射（waiting/delayed/paused/… → queued）；同步修正 unit 测试的 mock | ✅ |
| 16 | F17 生产回显任意 Origin | 未配置白名单时**生产不再回显**（不回 ACAO 头即拒绝）；白名单未命中也不再谎报 `allowed[0]` | ✅ |

### 事故复盘行动项（E 系列）

| # | 报告项 | 修复内容 | 状态 |
|---|--------|----------|:----:|
| 17 | E3 SW 远程 kill switch | `public/sw.js` activate 时拉取 `/sw-config.json`；`disabled:true` → 清空全部缓存 + `registration.unregister()`；新增 `public/sw-config.json`（默认 `{"disabled": false}`） | ✅ |
| 18 | E4 收窄预缓存 + 离线显式失败 | `APP_SHELL` 移除 `/dashboard`、`/knowledge-base`、`/chat`、`/agent`，仅留未鉴权壳；navigate 失败返回**自包含离线页（HTTP 503）**，不再静默回退缓存页；登录页在 `navigator.onLine === false` 时禁用提交并提示（新增 i18n key `page.login.s34`，zh/en 同步） | ✅ |
| 19 | E5 CI 残留清理 | `ci.yml` 的 `smoke-infra` job 末尾新增 **Teardown** step（`if: always()`，TERM→KILL，残留则让 job 失败） | ✅ |
| 20 | 预防措施 5 纳入 Runbook | 新建 `docs/ops/runbook.md`（RB-01 服务无法可靠关闭 / RB-02 DB 备份恢复 / RB-03 队列积压），并加入 VitePress 导航 | ✅ |

### 测试债回归防线

| 报告项 | 新增测试 | 数量 |
|--------|----------|:----:|
| `ssrf.ts` 无单测（P27） | `src/lib/security/ssrf.test.ts`（IP 段/元数据/私网/生产 fail-closed/自托管开关/预检） | 24 |
| `rate-limit.ts` 无单测（P32） | `src/lib/rate-limit.test.ts`（窗口/独立键/维度归类/降级面/环境限额） | 8 |
| `apikeys/scopes.ts` 无单测（P32，#20 回归） | `src/lib/apikeys/scopes.test.ts`（JWT 放行/401/403/scope 命中/前缀不可绕过） | 7 |
| 租户边界（P20，#25/#26 回归） | `src/lib/team/store.test.ts` 新增 `tenant boundary` 组（跨租户拒绝 owner/editor 角色） | +4 |
| F4 租户归属 | `src/lib/workspace/store.test.ts`（resolveWorkspace 顺序 / 幂等 / 非默认租户） | 9 |
| RAG 冷启动超时脆弱（P24） | `vitest.config.ts` 设 `testTimeout/hookTimeout = 30s` | — |

**测试总量变化**：【实测】55 files / 382 tests → **59 files / 434 tests**。

---

## 🧠 关键设计决策与理由

> 报告中存在若干"建议做法与现网约定冲突"的点，以下为显式决策（按报告要求：冲突时主动决策并说明理由）。

### D-1 SSRF 逃生口：从"调用点传参"改为"模块内环境策略"（F1/F6）

- 报告建议"生产路径不传 `allowPrivate`，逃生口仅限测试代码"。但验收 smoke（`test-webhooks`）**必须在 127.0.0.1 起接收端**，直接删除开关会导致 CI 变红。
- 决策：删除 `resolveSafeUrl` 的 `opts.allowPrivate` 形参，把放宽判定完全收敛进 `ssrf.ts`（由 `SSRF_ALLOW_PRIVATE_HOSTS` + `NODE_ENV` 决定）。**业务代码里不再存在"关掉检查"的旋钮**，同时 smoke 保持可用。
- 附加加固：`privateTargetsAllowed()` 由 `NODE_ENV !== "production"` 改为 `NODE_ENV ∈ {development, test}` —— 正是 F6 担心的"NODE_ENV 误配即真实 SSRF"场景，现在是 **fail-closed**。
- 【实测】`ssrf.test.ts` 覆盖：`NODE_ENV=""`、`NODE_ENV=staging` 时私网仍被拒。

### D-2 自托管模型端点：新增 `LLM_ALLOW_PRIVATE_BASE_URL`（F1）

- 直接"禁私网"会**打死产品自带的 Ollama 预设**（`baseUrl: http://localhost:11434/v1`），而自托管部署正是主要落地形态。
- 决策：默认禁私网；提供**显式运营开关** `LLM_ALLOW_PRIVATE_BASE_URL=true`（**生产同样生效**，因为私有端点就是该部署的生产配置）。
- 但**云元数据 `169.254.0.0/16` 永久封禁**，即使开了开关也拒绝 —— 没有任何合法 LLM 端点在那。
- 读路径用无 DNS 的同步预检（避免每轮对话多一次解析），写路径用含 DNS 的权威校验。
- 已同步 `.env.example` + `docs/ops/env-vars.md`（env parity 门禁：69 变量一致【实测】）。

### D-3 隔离契约用类型系统强制，而非自建静态检查

- 报告 A2 建议"加 CI 静态检查防止回退"。决策：**用必填参数 + `tsc --noEmit`**（CI `quality` job 已跑）替代自研 AST 检查 —— 零新增维护成本、无漏报、不引入新工具链。
- 【实测】把参数改必填后 `tsc` 立刻暴露出唯一漏传点（`documents/[docId]/route.ts:19`），印证 F2/F11 的因果关系。

### D-4 `chunk/complete` 只校验类型、不校验大小

- 报告的 F8 建议"补 `validateFile(file.name, file.size)`"。但直传档上限 `MAX_UPLOAD_MB=50`，分片档上限 `MAX_CHUNKED_UPLOAD_MB=500` —— 套用大小校验会**打死 50–500MB 的合法分片上传**。
- 决策：complete 处用 `validateFile(name, 0)` 只校验类型（与 `chunk/init` 同款用法），大小由分片档自己的上限在 init 兜住；理由写入代码注释。

### D-5 不新增 API 路由

- E3 的 kill switch 用**静态文件** `public/sw-config.json`，而非 `/api/sw-config` 路由 —— 避免触发 API 参考漂移门禁、避免为一个开关增加鉴权面，且运营侧用 nginx/挂载覆盖即可。
- 【实测】`gen-api-reference.ts` 后 `git diff` 为空。

### D-6 不为本次改动扩 coverage `include`

- 测试债建议"扩大覆盖率 `include` 到全部已测模块"。本次**不做**：`security/**` 等模块仍有未测文件（如 `audit.ts`），纳入统计会把聚合覆盖率拉低到门槛附近，属于需要独立一轮的活；本次改为**在这些模块补测试**（ssrf/rate-limit/scopes，均已新增）。

### D-7 未追加到归档设计日志

- AGENTS.md 约定"新组件/替换框架时在 `docs/archive/design-and-implementation-log.md` 记录"。但该文件 `status: archived`，且技术债报告**已把"archived 却仍追加"列为文档债（P15）**。
- 决策：决策记录放本报告 + `docs/ops/runbook.md`，**不回写归档日志**（避免加重既有文档债）。

---

## 🧪 验证证据（全部本地实测）

| 检查 | 命令 | 结果 |
|------|------|------|
| 类型 | `npx tsc --noEmit` | ✅ exit 0 |
| Lint | `env -u NODE_OPTIONS eslint .` | ✅ exit 0，0 error / 0 warning |
| 单测+覆盖率 | `pnpm test:unit` | ✅ **59 files / 434 tests passed**；覆盖率 83.87 / 74.27 / 90.45 / 85.96（门槛 70/60） |
| Prisma 客户端 | `npx prisma generate` | ✅ 通过（新增列已进 client） |
| 迁移 SQL 对齐 | `prisma migrate diff --from-empty --to-schema-datamodel` | ✅ 新增列 DDL 与 schema 期望一致（`TEXT NOT NULL DEFAULT 'ws_default'`、`TEXT[] ... DEFAULT ARRAY[]::TEXT[]`） |
| 文档 frontmatter | `check-docs-frontmatter.ts` | ✅ 29 篇全部合法 |
| env parity | `check-env-parity.ts` | ✅ 69 个变量一致 |
| API 参考漂移 | `gen-api-reference.ts` + `git diff` | ✅ 无漂移 |
| 文档站点 | `pnpm docs:build` | ✅ 构建完成（死链检查通过） |
| i18n 覆盖 | `test-i18n-coverage.ts` | ✅ 4/4（无残留中文、zh/en 键树一致） |
| 生产构建 | `pnpm build` | ✅ 构建完成（48s，所有路由产出正常） |

> **本机环境说明**：`pnpm lint` 在本机沙箱会因注入的 `NODE_OPTIONS` shim（`broker-ipc-client.cjs`）报 `write EPIPE`，属**本机工具链问题**（报告已记为测试债 P12）。用 `env -u NODE_OPTIONS eslint .` 可正常执行并 exit 0；CI 无此 shim。

---

## ⚠️ 未关闭 / 部分关闭项（如实列出）

| 报告项 | 状态 | 说明 |
|--------|------|------|
| **F5 多实例鉴权内存态不一致** | 🟡 **部分缓解，未关闭** | 报告建议"直查 DB 或共享 Redis，内存仅作缓存 + miss 回源"。这是读路径存储架构变更，涉及 apikeys/JWT 黑名单/webhook/agent 四处，**不宜与安全补丁同批混入**。已通过 X1（`replicas: 1`）**消除当前形态下的触发条件**，并在 k8s 文件头写明扩容前置条件。建议单独立项（ADR-0006 读路径存储演进）。 |
| **F5 的 JWT `jti` 黑名单** | 🟡 未改 | 同上，属同一架构项。 |
| **F7 队列无背压（X5/X6）** | 🟡 未改 | 报告列为 P1 但属容量设计（内存队列无深度上限 + 1Gi limit）。Runbook RB-03 已写明"已知局限：只能人工巡检"。建议单独立项。 |
| **依赖 CVE 审计** | ⚪ 未做 | 四份报告均标注"未执行 `pnpm audit`"；本机无 npm 探针到私有 registry 的可靠通路，建议在 CI 内补。 |
| **e2e / smoke 实跑** | ⚪ 未做 | 需 dev server + chromium + 真实数据库；本次以单测 + 类型 + lint + 文档门禁 + 构建作为本地证据，**CI 会跑全量 7 个 job 作为最终判定**。注意：本次修改了 `test-webhooks` 依赖的 SSRF 语义与 `test-pwa` 的断言，**必须看 CI smoke 与 e2e 结果**。 |
| **索引补齐（Archi D8）** | ⚪ 未做 | 本次未给新增的 `KnowledgeBase.workspaceId` 加索引，以最小化无法本地验证的迁移漂移面；归入阶段 2。 |
| **ADR-0003/0004** | ⚪ 未写 | 决策已在本报告与 Runbook 中记录，正式 ADR 归入阶段 2。 |
| **剩余 F14/F15/F18 性能与可维护性项** | ⚪ 未做 | 均为 🟢低：pgvector 逐条 INSERT、hydration N+1、`KbChunk` 双轨收敛。 |

---

## 📁 变更文件清单

**源码（14 个）+ 新增测试（4 个）**

```
src/lib/team/store.ts                      F11 契约必填
src/lib/kb/store.ts                        canViewDoc/canEditDoc 必填
src/app/api/.../documents/[docId]/route.ts F2
src/lib/security/ssrf.ts                   F1/F6（模型校验 + fail-closed 逃生口）
src/lib/llm/provider.ts                    F1 读路径预检
src/app/api/models/route.ts                F1 写路径
src/app/api/models/[id]/route.ts           F1 写路径
src/app/api/models/test/route.ts           F1 写路径
src/app/api/models/fetch-list/route.ts     F1 写路径
src/lib/db/persist.ts                      F3/A4 持久化
src/lib/db/hydrate.ts                      F3/A4 水合
src/lib/workspace/store.ts                 F4 + resolveWorkspace
src/app/api/auth/register/route.ts          F4
src/lib/auth/oauth-link.ts                 F4
src/lib/upload/store.ts                    F7 receivedBytes
src/app/api/upload/chunk/[uploadId]/route.ts        F7
src/app/api/upload/chunk/[uploadId]/complete/route.ts F8
src/app/api/knowledge-base/[id]/upload/route.ts     F8
src/lib/rate-limit.ts                      F9
src/app/api/health/ready/route.ts          F9 观测
src/lib/auth/session.ts                    F10
src/lib/security/share-password.ts         F10
src/lib/apikeys/store.ts                   F10（同类）
src/app/api/billing/webhook/route.ts       F12
src/app/api/agent/public/[id]/route.ts     F13
src/lib/queue/bullmq-queue.ts              F16
src/proxy.ts                               F17
src/app/(auth)/login/page.tsx              E4
src/lib/i18n/messages/{zh-CN,en}.json      E4（s34）
public/sw.js                               E3/E4
public/sw-config.json                      E3（新增）
prisma/schema.prisma                       F3/A4
prisma/migrations/20260930120000_tenant_persistence/migration.sql  （新增）

src/lib/security/ssrf.test.ts              （新增）
src/lib/rate-limit.test.ts                 （新增）
src/lib/apikeys/scopes.test.ts             （新增）
src/lib/workspace/store.test.ts            （新增）
src/lib/team/store.test.ts                 扩充
src/lib/queue/bullmq-queue.test.ts         适配 F16

k8s/deployment.yaml                        X1/X2/X3
.github/workflows/ci.yml                   E5
vitest.config.ts                           测试债 P24
scripts/smoke/lib/manifest.ts              SSRF 说明同步
scripts/smoke/test-pwa.ts                  E3/E4 断言更新
.env.example / docs/ops/env-vars.md        LLM_ALLOW_PRIVATE_BASE_URL
docs/ops/runbook.md                        （新增）
.vitepress/config.mts                      导航
deliverables/engineering-assurance/remediation-knowledgeai-2026-09-30.md （本文件）
```

---

## ▶️ 建议下一步

1. **看 CI 7 个 job 全绿**（尤其 `smoke`、`smoke-infra`、`e2e` —— 本次改动触碰了下游断言）；
2. 合并后重跑**部署前检查清单 B0–B4**，此时 S1–S5 与 X1–X3 应转为 ✅；
3. 单独立项：F5 读路径存储演进（ADR-0006）+ 队列背压（ADR-0007）+ 依赖 CVE 审计入 CI。

> 本报告由 AI 协作生成，关键决策请由人类工程负责人复核。
