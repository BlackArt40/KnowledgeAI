# KnowledgeAI (KAI) 技术债评估报告

**日期**：2026-09-30
**工作流**：工作流 5（技术债评估）
**参与成员**：Cody（代码/依赖债）、Archi（架构债）、Tessa（测试债）、Docu（文档债）
**优先级公式**：`Priority = (Impact + Risk) × (6 - Effort)`，各因子取值 1–5（Impact/Risk 越大越严重，Effort 越大越易做）
**合并去重后债务总量**：**57 项**（代码 13 + 架构 16 + 测试 14 + 文档 12，去重后）

---

## 📌 TL;DR（执行摘要）

- 整体结论：技术债**高度集中在「多租户隔离」与「安全/租户/核心链路缺乏单元测试」两个主题**；单条最高优先级（P40）全部落在多租户隔离簇与部署配置冲突上。
- 严重度分布（按 Priority 分档）：**P≥36 极高 4 项** / **P24–32 高 12 项** / **P16–21 中 16 项** / **P≤15 低 25 项**
- 阻塞 / 非阻塞：**4 项属发布阻塞**（D4 / D16 / KB 持久化 / 隔离校验可选），其余非阻塞
- 关键结论：**修 D4 是 1 行、修隔离校验是接口收紧、修持久化需补迁移**——前 4 项应合并为**一个高优工程项**（多租户隔离收敛）

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🟡 **需分期治理**（非紧急但必须规划；租户簇为发布门禁） |
| 阻塞项数量 | **4**（多租户隔离簇 + 部署配置冲突） |
| 关键行动项 | **6 条**（见行动清单） |
| 建议下一步 | 先做「阶段 0：租户隔离簇 + 部署配置」，再做「阶段 1：安全/测试补强」，最后「阶段 2：结构收敛与文档治理」 |

---

## 📋 最高优先级债务（Top 15）

> 说明：Cody 原始清单中「KB workspaceId 未持久化」「模型 baseUrl 无 SSRF 校验」「自助注册落默认租户」三行给出的 Priority 与其公式不符，主理人**已按 `(I+R)×(6−E)` 重算**并标注；Archi / Tessa / Docu 的数值经复核全部正确。

| 排名 | 债务项 | 主题 | 位置 | I | R | E | Priority | 来源 |
|:--:|--------|------|------|:-:|:-:|:-:|:-:|------|
| 1 | 单文档 GET 漏传 `workspaceId`，跨租户读 | 多租户 | `documents/[docId]/route.ts:19` | 4 | 4 | 1 | **40** | Archi D4 / Cody #2 |
| 2 | k8s `replicas:2` + RWO PVC 与「单实例内存设计」冲突（多节点开箱即坏） | 部署 | `k8s/deployment.yaml:37,24-25` | 4 | 4 | 1 | **40** | Archi D16 / Rex |
| 3 | `KB.workspaceId` 未持久化，hydrate 一律归 `ws_default` | 多租户 | `schema.prisma:125`；`hydrate.ts:265` | 5 | 5 | 2 | **40** | Cody〔重算〕/ Archi D1 |
| 4 | 隔离校验参数可选，漏传即静默关闭 | 多租户 | `team/store.ts:215-236` | 4 | 5 | 2 | **36** | Archi D3 |
| 5 | 模型自定义 `baseUrl` 无 SSRF 校验 | 安全 | `models/*`；`llm/provider.ts:87` | 4 | 4 | 2 | **32** | Cody〔重算〕 |
| 6 | 自助注册自动落入默认租户 → 可读默认组织 KB | 授权 | `workspace/store.ts:79`；`auth/store.ts:177` | 4 | 4 | 2 | **32** | Cody〔重算〕 |
| 7 | `rate-limit.ts` 无单元测试（滑动窗口/分层/Redis 回退） | 测试 | `security/rate-limit.ts` | 4 | 4 | 2 | **32** | Tessa |
| 8 | `apikeys/scopes.ts` 权限范围矩阵无单测（#20 绕过回归） | 测试 | `apikeys/scopes.ts` | 4 | 4 | 2 | **32** | Tessa |
| 9 | billing webhook 幂等/重放无单测 | 测试 | `billing/webhook` | 3 | 4 | 2 | **28** | Tessa |
| 10 | `ssrf.ts` SSRF 判定无单测（私网/回环/元数据） | 测试 | `security/ssrf.ts` | 4 | 5 | 3 | **27** | Tessa |
| 11 | `Workspace.members` 未持久化，重启丢成员关系 | 多租户 | `persist.ts:751` | 4 | 5 | 3 | **27** | Archi D2 |
| 12 | 索引缺口（Conversation/Message/AgentTask/LoginEvent/Invoice） | 数据模型 | `prisma/schema.prisma` | 3 | 3 | 2 | **24** | Archi D8 |
| 13 | `product-overview` 系统架构图过时（Vercel/LangChain/微服务） | 文档 | `product-overview.md:296-326` | 3 | 3 | 2 | **24** | Docu |
| 14 | 分片/直传上传校验缺失（单片无上限、未 validateFile） | 安全 | `upload/chunk/[uploadId]:47`；`kb/[id]/upload:97` | 3 | 3 | 2 | **24** | Cody |
| 15 | 租户边界单测缺失（#25/#26 回归高发区） | 测试 | `workspace/store.ts`、`kb/store.ts`、`team` | 5 | 5 | 4 | **20** | Tessa |

---

## 🧾 全量债务清单（按主题分组）

### A. 多租户隔离与持久化（本次审计核心风险簇）
| 债务项 | 位置 | I | R | E | Priority | 来源 |
|--------|------|:-:|:-:|:-:|:-:|------|
| 单文档 GET 漏传 `workspaceId`（跨租户读） | `documents/[docId]/route.ts:19` | 4 | 4 | 1 | 40 | Archi/Cody |
| `KB.workspaceId` 未持久化 | `schema.prisma:125`；`hydrate.ts:265` | 5 | 5 | 2 | 40 | Cody/Archi |
| 隔离校验参数可选，漏传即静默关闭 | `team/store.ts:215-236` | 4 | 5 | 2 | 36 | Archi |
| `Workspace.members` 未持久化 | `persist.ts:751` | 4 | 5 | 3 | 27 | Archi |
| `workspaceId` 无外键/引用完整性（悬空字符串） | `schema.prisma` 多表 | 3 | 3 | 3 | 18 | Archi |
| `Team` 单例 + 默认访问按 KB 名称（跨租户同名 KB 共享默认访问） | `team/store.ts` | 3 | 3 | 4 | 12 | Archi |
| 权限模型碎片化（全局 Role + Team + per-KB + Workspace 四套并存） | `auth`/`team`/`kb`/`workspace` | 4 | 4 | 5 | 8 | Archi |
| 单实例内存读路径，无逐出/多实例不一致 | 全局 store 设计 | 4 | 4 | 5 | 8 | Archi |

### B. 安全与失效控制
| 债务项 | 位置 | I | R | E | Priority | 来源 |
|--------|------|:-:|:-:|:-:|:-:|------|
| 模型 `baseUrl` 无 SSRF 校验 | `models/*`；`llm/provider.ts:87` | 4 | 4 | 2 | 32 | Cody |
| 自助注册自动落入默认租户 | `workspace/store.ts:79`；`auth/store.ts:177` | 4 | 4 | 2 | 32 | Cody |
| 分片/直传上传校验缺失 | `upload/*`；`kb/[id]/upload:97` | 3 | 3 | 2 | 24 | Cody |
| 密码/PBKDF2 校验非恒定时间 | `auth/session.ts:207`；`share-password.ts:42` | 2 | 2 | 1 | 20 | Cody |
| 限流 Redis 失效静默回落（多实例绕过） | `rate-limit.ts:170-197,279` | 3 | 3 | 3 | 18 | Cody |
| JWT 撤销黑名单仅内存 | `auth/session.ts:114-133` | 3 | 3 | 3 | 18 | Cody |
| webhook `allowPrivate` 逃生口开在业务路径 | `queue/handlers.ts:183`；`v1/webhooks/*` | 3 | 2 | 2 | 20 | Cody |
| billing webhook `JSON.parse` 无 try/catch + 无 event.id 去重 | `billing/webhook/route.ts:17` | 2 | 2 | 1 | 20 | Cody |
| 分享密码可经 URL query 传递 | `agent/public/[id]/route.ts:26` | 2 | 1 | 1 | 15 | Cody |
| 公共 API 默认回显任意 Origin | `src/proxy.ts:184` | 1 | 2 | 1 | 15 | Cody |
| 服务不可被可靠关闭 / SW 内容 fail-open / 无法远程注销 SW | `public/sw.js:78-89,40-53` | 3 | 3 | 2 | 24 | Rex |

### C. 数据模型 / 迁移 / 结构
| 债务项 | 位置 | I | R | E | Priority | 来源 |
|--------|------|:-:|:-:|:-:|:-:|------|
| 索引缺口（Conversation/Message/AgentTask/LoginEvent/Invoice） | `schema.prisma` | 3 | 3 | 2 | 24 | Archi |
| 16 迁移全部单向 forward-only、无回滚 | `prisma/migrations` | 3 | 4 | 3 | 21 | Archi |
| `KbChunk` 死模型 vs 运行时 `kb_chunks` 双轨 | `schema.prisma`；`vector-store-pgvector.ts` | 2 | 2 | 2 | 16 | Archi |
| 模块循环依赖（`auth↔security` 运行时环等） | `src/lib` | 3 | 2 | 3 | 15 | Archi |
| 上帝模块 `persist.ts`(1151) / `hydrate.ts`(1069) 放大 4 处契约 | `src/lib/db` | 3 | 3 | 4 | 12 | Archi |
| 队列无背压/容量上限，内存无界增长（配合 1Gi limit → OOMKilled） | `queue/*` | 3 | 3 | 3 | 18 | Archi/Rex |
| pgvector 逐条 INSERT（大文档串行往返） | `vector-store-pgvector.ts:185` | 2 | 1 | 2 | 12 | Cody |
| hydration N+1 | `hydrate.ts:368,576` | 2 | 1 | 2 | 12 | Cody |
| 双份密码哈希实现（Web Crypto vs node pbkdf2Sync） | `session.ts:171-208`；`share-password.ts` | 2 | 1 | 2 | 12 | Cody |
| 内存 `globalThis` 为读唯一来源（多实例鉴权不一致） | `apikeys/webhooks/agent/security/store.ts` | 5 | 4 | 5 | 9 | Cody |

### D. 测试债（Tessa）
| 债务项 | I | R | E | Priority |
|--------|:-:|:-:|:-:|:-:|
| `rate-limit.ts` 补单元测试 | 4 | 4 | 2 | 32 |
| `apikeys/scopes.ts` 权限范围矩阵单测 | 4 | 4 | 2 | 32 |
| billing webhook 幂等/重放单测 | 3 | 4 | 2 | 28 |
| `ssrf.ts` SSRF 判定单测 | 4 | 5 | 3 | 27 |
| 修 RAG 测试超时脆弱性（静态 import / 调 testTimeout） | 3 | 3 | 2 | 24 |
| `queue/handlers.ts` 分发单测 | 3 | 3 | 2 | 24 |
| `chat/ask.ts` 问答链路单测 | 4 | 3 | 3 | 21 |
| 租户边界单测（workspace/kb/doc-share/team，#25/#26 回归） | 5 | 5 | 4 | 20 |
| 扩大覆盖率 `include` 到全部已测模块 | 2 | 2 | 1 | 20 |
| `authjs.ts`/`oauth-signin.ts` 登录链路单测（当前 0%） | 3 | 3 | 3 | 18 |
| `retriever.ts` 深路径补测（当前 55.81%，最低） | 3 | 3 | 3 | 18 |
| `agent/orchestrator`/`run-handler` 单测 | 4 | 4 | 4 | 16 |
| e2e 仅 1 spec（main-flow 6 用例），补关键流程 | 3 | 3 | 4 | 12 |
| 沙箱 lint EPIPE（NODE_OPTIONS shim）工具链问题 | 1 | 2 | 2 | 12 |

### E. 文档债（Docu）
| 债务项 | 位置 | I | R | E | Priority |
|--------|------|:-:|:-:|:-:|:-:|
| 无正式 Runbook（事故/on-call、DB 备份恢复、队列积压处置） | `docs/ops/` | 3 | 4 | 3 | 21 |
| 产品概述系统架构图过时（Vercel/LangChain/LangGraph/微服务） | `product-overview.md:296-326` | 3 | 3 | 2 | 24 |
| CI job 数低报（README/faq/onboarding 三处 5 vs 实际 7） | `README:21`/`faq:111`/`onboarding:77` | 2 | 2 | 1 | 20 |
| `overview` 模块地图缺 11 个模块 | `architecture/overview.md:142-156` | 3 | 2 | 2 | 20 |
| `doc-writing-standards` 引用不存在的 job 名 + 时效策略未落地 | `standards/doc-writing-standards.md:18,66-69` | 2 | 2 | 2 | 16 |
| 代码 env 未登记（`CONFLUENCE_API_URL`/`PINECONE_INDEX_NAME`） | `.env.example`/`ops/env-vars.md` | 1 | 2 | 1 | 15 |
| 设计日志 status 标注冲突（archived 却仍追加） | `archive/design-and-implementation-log.md` | 2 | 1 | 1 | 15 |
| onboarding CI job 数自相矛盾（L77 vs L99） | `onboarding.md` | 2 | 1 | 1 | 15 |
| standards 缺代码/Git/测试规范 | `docs/standards/` | 2 | 2 | 3 | 12 |
| `integrations/*/README`、`tests/README` 不受 docs 治理/CI 覆盖 | `integrations/`,`tests/` | 1 | 2 | 2 | 12 |
| 内部 96 个 API 路由无参考文档（设计取舍） | `docs/api/` | 3 | 2 | 4 | 10 |
| `tests/README` 路由数 35 vs 38 | `tests/README.md` | 1 | 1 | 1 | 10 |

### F. 依赖债（Cody）
| 债务项 | 位置 | I | R | E | Priority |
|--------|------|:-:|:-:|:-:|:-:|
| `next-auth 5.0.0-beta.32`（beta 依赖用于生产鉴权） | `package.json` | 3 | 3 | 3 | 18 |
| `xlsx` 走非 registry CDN tarball（`cdn.sheetjs.com`，供应链风险） | `package.json` | 2 | 3 | 3 | 15 |

> **依赖漏洞审计未完成**：当前环境无 npm/pnpm CLI，未执行 `pnpm audit` → CVE 情况标注【假设】，需在 CI 内补测。

---

## 🗓️ 分阶段修复计划

### 阶段 0 —— 发布门禁（P0，1 周内）
> 目标：清除 4 项发布阻塞，消除"多租户静默串租"的系统性风险。

| 项 | 动作 | 工作量 |
|----|------|--------|
| A1 | `documents/[docId]/route.ts:19` GET 补传 workspace 边界（**1 行级**） | 0.5 天 |
| A2 | `canViewKb/canEditKb` 的 workspace 参数改**必填**，全调用点对齐；加 CI 静态检查防止回退 | 1–2 天 |
| A3 | `KnowledgeBase` 增 `workspaceId` 列 + 迁移（`prisma migrate dev`）；`hydrate.ts:265` 读真实列 | 2–3 天 |
| A4 | `Workspace.members` 落库（`persist.ts` + schema） | 2 天 |
| A5 | k8s 清单 `replicas` 改 1 + 注释「扩容前须先补持久化 + 改 RWX/对象存储」；整份标注"示例，不可直接用于生产" | 0.5 天 |
| A6 | 模型 `baseUrl` 接入 `resolveSafeUrl`（4 处调用） | 1 天 |

### 阶段 1 —— 安全与测试补强（P1，2–4 周）
- F4 自助注册租户归属修正；F9 限流回落告警；F7/F8 上传大小与类型校验；F5 鉴权路径改直查 DB/Redis。
- 测试：#1 rate-limit（P32）、#2 apikeys/scopes（P32）、#3 billing 幂等（P28）、#4 ssrf（P27）、#8 租户边界（P20）、#9 扩大覆盖率 include。
- 迁移策略：为破坏性迁移建立"部署前 pg_dump + migrate status 记录"回滚点流程（与部署清单 D2 对齐）。

### 阶段 2 —— 结构收敛与文档治理（P2，1–2 月）
- 索引补齐（D8）；`workspaceId` 外键/引用完整性（D7）；`KbChunk` 双轨收敛（D10）；队列背压（D11）。
- 补写 ADR-0003/0004（多租户隔离与持久化契约）；权限模型收敛（D5）；内存读路径演进决策（ADR-0006）。
- 文档：修 3 处 CI job 数、重绘 `product-overview` 架构图、补 `overview` 模块地图、新建 `ops/runbook.md`、登记 2 个缺失 env。

---

## 💰 投入产出预估

| 阶段 | 投入（人日，估） | 产出/收益 | 风险降低 |
|------|:--:|-----------|---------|
| 阶段 0 | **7–9 人日** | 消除跨租户读、租户数据重启失真、多实例静默串租、模型 SSRF、k8s 配置冲突 | **极高**（阻塞项清零，隔离第一次真正"落库"） |
| 阶段 1 | **12–18 人日** | 安全边界加固 + 4 个高风险模块获得回归防线 | 高（防回归，尤其是 #20/#25/#26 类已修漏洞） |
| 阶段 2 | **20–30 人日** | 结构收敛、性能与可维护性提升、文档与实现对齐 | 中（长期可维护性） |

**ROI 最高动作**：阶段 0 的 A1（1 行）+ A2（接口收紧）——以**极小成本**关闭"跨租户读 + 隔离静默失效"两个最高危面。

**关键洞察**：`多租户隔离簇`（A1–A4 + 部署 A5）相互放大，**必须作为一个整体交付**，分批做会留下中间态漏洞。

---

## ✅ 行动清单

| # | 行动 | 负责角色 | 紧急度 | 预期完成 |
|---|------|---------|--------|---------|
| 1 | 修复单文档 GET 越权 + 隔离校验参数改必填（A1/A2） | 后端 owner | **P0** | 3 天内 |
| 2 | `KB.workspaceId` + `Workspace.members` 落库迁移（A3/A4） | 后端 owner | **P0** | 1 周内 |
| 3 | 修正 k8s 清单 `replicas:1` 并标注示例限制（A5） | 运维 owner | **P0** | 3 天内 |
| 4 | 接入 SSRF 校验 + 上传校验 + 限流回落告警（A6/F7/F8/F9） | 后端 owner | P1 | 2 周内 |
| 5 | 补 4 项高优单元测试（rate-limit/apikeys/scopes/ssrf/租户边界） | 测试 owner | P1 | 3 周内 |
| 6 | 补 ADR-0003/0004 并治理文档债（CI job 数/架构图/模块地图/Runbook） | 架构/文档 owner | P2 | 1 月内 |

---

## ⚠️ 待完善 / 已知局限

- **计算公式订正**：Cody 原始清单中 3 项 Priority 与其公式不符，本报告已重算（P40/P32/P32）；其余成员数值经复核无误。不同成员对同一债务的 Effort 估计存在差异（如 KB 持久化 E=2 vs E=3），本报告取更保守（更高 Priority）者，实际排期需 human 校准。
- **依赖 CVE 未测**：无 `pnpm audit` 结果，依赖债仅含"已知结构性风险"（beta 依赖、非 registry tarball）。
- **投入估算为量级估计**，非承诺工期。
- **未含运行时性能实测**：队列背压、hydration N+1 的性能影响未做压测量化。

---

## 📚 数据来源 & 成员产出索引

- **Cody（代码审查师）**：13 项代码/依赖债务（含公式订正 3 项）。
- **Archi（系统架构师）**：16 项架构债务（D1–D16，含优先级算式与 D16 精度更正）。
- **Tessa（测试专家）**：14 项测试债（含覆盖率盲区与冷启动超时脆弱性）。
- **Docu（技术文档师）**：12 项文档债（含 4 项 CI 门禁实测全绿、跨文档口径漂移清单）。
- **Rex（SRE）**：队列背压 / 迁移回滚 / SW 失效控制相关债项。

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
