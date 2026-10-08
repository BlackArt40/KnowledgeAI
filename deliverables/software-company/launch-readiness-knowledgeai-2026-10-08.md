# KnowledgeAI 上线体检报告（Launch Readiness）

**日期**：2026-10-08
**团队**：software-kai-launchcheck（主理人：齐活林 · 交付总监；成员：严过关 · QA 工程师、高见远 · 架构师）
**对象**：`/Users/wsy/Project/KnowledgeAI` · 分支 `fix/engineering-assurance-p0-p1` @ `b9e2bc5`（PR #27）· 目标 `main`
**上一轮基线**：2026-09-30 工程保障审计（4 项安全阻塞 + k8s 配置冲突 → **No-Go**）
**证据等级**：【实测】= 命令输出 / CI 日志 / file:line；【推断】= 基于调用链逻辑；【假设】= 无直接证据

---

## 📌 TL;DR

- **总体决策**：🟡 **No-Go（发布工程条件未满足；可快速转 Go）**
- 一句话：**代码内核实测就绪**——安全阻塞 4/4 源码级闭合、全部质量门禁独立复跑全绿、修正后 smoke http 组实测 18/0 全绿；**但 PR #27 当前提交不可合并**——CI 实际 5/7（smoke ❌ / smoke-infra ❌）且 4 个关键修正文件未提交，而它们**恰是这批 CI 失败的红修**（"本地全绿"声称与 CI 事实不符）。
- **转 Go 三步（预计半天内）**：① 4 文件原子提交并推送 → ② CI 7/7 全绿（重点 smoke / smoke-infra）→ ③ 部署环境必修配置（CORS_ALLOWED_ORIGINS、LLM_ALLOW_PRIVATE_BASE_URL）+ 备份/回滚点 + 预发补测。

## 🎯 核心结论卡片

| 维度 | 结论 |
|------|------|
| Must-fix 清单（上轮 9 项） | ✅ 8 项闭合 + ➖ 1 项设计规避（S4/靠单实例）；**无新增安全阻塞** |
| 质量门禁（QA 独立重跑） | ✅ 全绿：tsc / eslint / **435 单测全过** / 覆盖率四模块达标 / build / smoke lib 17/17 |
| 发布物一致性 | ❌ **工作区 ≠ CI 验证内容**（4 个关键文件未提交） |
| CI 状态 @ `b9e2bc5` | ❌ **5/7**：smoke（6 脚本 ~17 项）+ smoke-infra（2 项）→ 根因已定位、修正已实测验证 |
| 修正后本地实测 | ✅ smoke http 组 **18/0/0**（基线 12/6），6 个失败脚本逐项转绿 |
| 最终决策 | 🟡 **No-Go（可快速转 Go）** |

---

## 1. 体检方法（三方独立验证）

| 验证方 | 方式 | 关键发现 |
|--------|------|---------|
| **主理人** | GitHub CI 记录交叉分析 + 失败日志全量拉取 + 成员结论交叉对齐 | **发现 CI 实为 5/7 而非全绿**（整改报告"本地全绿"与 CI 事实矛盾）；定位 2 个失败 job 的完整失败清单 |
| **QA（严过关）** | 独立重跑全部门禁（不采信整改方数字）+ HEAD/工作区源码对比实证 + 修正后 http 组复跑 | 门禁 PASS（有条件）；HEAD 源码回归**实锤**；修正后 http 组 18/0 全绿 |
| **架构师（高见远）** | Must-fix 逐项源码级复核（file:line 证据）+ CI 失败逐脚本根因初判 | 8/9 清单项闭合；6 脚本 17 项失败**全部同源**，未提交修正可全修复 |

## 2. Must-fix 清单验证结果（对照 2026-09-30 No-Go）

| # | 项目 | 上轮 | 本轮 | 关键证据（详见架构师报告 §1） |
|---|------|:----:|:----:|------|
| S1 | 模型 `baseUrl` SSRF | ❌ | ✅ | `ssrf.ts` fail-closed（仅 dev/test + 逃生口）；169.254/16 永久封禁（含 IPv4-mapped）；5 个调用点全部 `await resolveSafeUrl` 失败即拒 |
| S2 | 跨租户读 + 隔离必填化 | ❌ | ✅ | `loadDoc` 统一传 `workspaceId`；4 个校验函数参数**必填**（漏传即 tsc 失败）；全仓 **33 处调用点零漏传** |
| S3 | `KB.workspaceId` 落库 | ❌ | ✅ | 迁移 `ADD COLUMN ... DEFAULT 'ws_default'` 已提交；persist/hydrate 读写真实列 → **重启不再归并 `ws_default`**；老数据回填与旧行为一致、不新增串租 |
| S4 | 多实例鉴权内存态 | ❌ | ➖ | **设计决策规避**（非修复）：`replicas:1` + 单容器蓝绿/compose；扩容即回归，属 ADR-0006 |
| S5 | 自助注册落默认租户 | ❌ | ✅* | `ensurePersonalWorkspace` 注册即建个人区；*解析顺序修正**依赖未提交文件**（见 §5） |
| X1/X2/X3 | k8s 清单冲突 | ❌ | ✅ | `replicas: 1` + "示例清单"标注 + RWO/内存态扩容前置条件（三条） |
| — | 部署前置 runbook | ❌ | ✅ | `runbook.md` RB-02 覆盖 `pg_dump` 全量备份 + `migrate status` 回滚点登记 |

## 3. CI 失败事实与根因（本次体检核心）

### 3.1 CI 事实【实测】（run `36709923366` @ `b9e2bc5`）

| job | 状态 | 明细 |
|-----|:----:|------|
| quality / unit / integration / e2e / Docs | ✅ 5 绿 | — |
| **smoke** | ❌ | lib 17/17 ✅、limits ✅、**http 组 12 pass / 6 fail**、ui 未执行 |
| **smoke-infra** | ❌ | **test-integrations 28/30**（2 项 CORS 断言失败） |

失败脚本清单：test-workspaces(8)、test-global-search(3)、test-kb-permissions(3)、test-theme(1)、test-webhooks(1)、test-graph-rag(1)。

### 3.2 根因（架构师 §8 静态初判 + QA 实测对齐）

- **根因 A（smoke http 17 项，6 脚本全部同源）**：`HEAD` 版 `resolveWorkspace`（`workspace/store.ts:98-109`）为 "owned 优先" 顺序——demo 用户（owner/editor）一旦在测试中新建工作区，其**无 cookie 请求即漂移**到该工作区，而验收脚本普遍假设"无 cookie ⇒ `ws_default`"，于是断言集体反转。
  - ⚠️ **安全性澄清（重要）**：这**不是新的跨租户泄露**。各路由的租户校验（webhooks/graph/knowledge-base）都是**正确的**——是它们**暴露**了漂移问题；修复方向 = 提交解析修正，**严禁**把失败"修复"成回退路由租户校验（那会重开 S2/F11 已关闭的跨租户面）。
- **根因 B（smoke-infra 2 项）**：F17 CORS 收紧（生产无 allowlist → deny）后，**已提交**的 smoke 断言仍断言"回显 Origin"——断言与已发布代码冲突；修正恰在未提交区。

### 3.3 修复有效性验证（QA 实测，推演 → 实测）

| 层级 | 方法 | 结果 |
|------|------|------|
| 单测层【实测】 | 用 **HEAD 源码**跑新增回归用例 | ❌ `expected 'ws_4b277012e821' to be 'ws_default'` ——实锤 HEAD 把"默认成员+另拥有工作区"者**错误移出默认租户** |
| 单测层【实测】 | 工作区（修正版）源码 | ✅ 通过 |
| http 组层【实测】 | 修正后复跑 `--group http --elevate 5000` | ✅ **18 passed / 0 failed / 0 skipped**（基线 12/6）；6 脚本逐项转绿：workspaces(1.8s ✅)、global-search 28/28、kb-permissions ✅、theme 17/17、webhooks 31/31、graph-rag 20/20 |

**结论**：修复生效性已实测坐实；提交推送后 CI `smoke` 预计转绿。

## 4. 质量门禁独立验证（QA，全部亲自重跑）

| 检查项 | 结果 | 备注 |
|--------|------|------|
| `tsc --noEmit` | ✅ exit 0 | — |
| eslint（`env -u NODE_OPTIONS`） | ✅ exit 0 | `pnpm lint` 为沙箱 NODE_OPTIONS shim 环境性失败（EPIPE），非代码问题 |
| 单元测试 | ✅ **59 文件 / 435 测试全过**、0 超时 | 比整改方多 1 个 = 未提交的新回归用例 |
| 覆盖率（门槛 70/60） | ✅ All **83.87 / 74.27 / 90.45 / 85.96**；auth/billing/rag/team 四模块全达标 | 与整改方数字完全一致 |
| 生产构建 | ✅ exit 0，13/13 页，产出 standalone | 沙箱内被 shim 拦（环境性），绕过命令通过 |
| smoke lib 组 | ✅ 17 passed / 0 failed | — |

## 5. 发布物一致性（阻断 B2，**放行条件**）

**工作区 4 个未提交文件均为"让修复自洽"的关键件**（`git status`）：

| 文件 | 性质 | 处置 | 理由（实测） |
|------|------|:----:|------|
| `src/lib/workspace/store.ts` (+27/-11) | **源码·回归修复** | **必须纳入** | HEAD 版存在真实租户解析回归（§3.3 实锤）；缺它 → 发布带回归 + CI smoke 红 |
| `src/lib/workspace/store.test.ts` (+18) | 回归测试 | **与上者原子提交** | 该用例仅在修正版通过；单独提交 → CI 红；不提交 → 缺回归防线 |
| `scripts/smoke/test-integrations.ts` (+75/-11) | F17 断言同步 | **必须纳入** | 旧断言与已发布 F17 代码冲突 → smoke-infra 必红 |
| `deliverables/.../remediation-*.md` (+1) | 文档 | 可选 | 仅 PR 链接一行，不影响门禁 |

**纪律**：`store.ts` + `store.test.ts` **必须成对提交**；**不得**为让 CI 变绿而回退任何路由租户校验。

## 6. Go / No-Go 决策

### 决策：🟡 **No-Go（可快速转 Go）**

| 判据 | 结论 |
|------|------|
| 安全内核（S1/S2/S3/S5） | ✅ 源码级闭合、无新增安全阻塞 |
| 质量门禁（tsc/lint/单测/覆盖率/构建） | ✅ 全绿（独立复跑） |
| 验收测试（smoke http 修正后） | ✅ 18/0 实测全绿 |
| **可合并性（CI 7 job）** | ❌ 当前提交 5/7——**不可合并、不可部署** |
| **发布物一致性** | ❌ 工作区 ≠ CI 验证内容（4 文件未提交） |
| 部署配置就绪 | ⚠️ 两项环境必修 + 备份/回滚点待做 |

**阻止发布的理由**：PR #27 目前状态 = CI 红 + 修正未提交。**发布动作本身必须等待**：提交-推送-复跑 CI 全绿。这不是代码缺陷问题（修正已完成并实测有效），而是**发布工程流程未走完**。

### 转 Go 条件（全部满足即 Go）

1. 提交并推送 4 个文件（`store.ts`+`store.test.ts` 原子；`test-integrations.ts` 必带）→ **CI 7/7 全绿**（重点 smoke / smoke-infra / e2e）；
2. 部署环境配置：`CORS_ALLOWED_ORIGINS`（生产显式列出 widget 来源，否则第三方 widget 断）、自托管 LLM 场景 `LLM_ALLOW_PRIVATE_BASE_URL=true`（否则用户私有 baseUrl 静默失效回落演示模式）、`SSRF_ALLOW_PRIVATE_HOSTS` 生产保持 false；
3. 部署前置：`pg_dump` 全量备份 + `prisma migrate status` 回滚点登记（RB-02）；保持 `replicas:1`；预发补测运行时项（B1–B3）。

## 7. 部署前置清单（Go 之前必须完成）

1. 4 文件原子提交推送 + CI 全绿（见 §6）；
2. 生产 `CORS_ALLOWED_ORIGINS` 显式配置；同时修正 `docs/ops/env-vars.md:60` 对 CORS 的过时描述（仍写"空（反射任意 Origin）"，与 F17 deny 语义不符）；
3. 自托管 LLM：`LLM_ALLOW_PRIVATE_BASE_URL=true`；
4. DB 回滚点：`pg_dump "$DATABASE_URL" -Fc` + `prisma migrate status`；迁移先于应用新版执行、向下兼容；
5. ⚠️ 破坏性迁移 `drop_dead_tables` 已存在 → **禁止部署后直接回退镜像**，回滚只能前向修复或快照恢复；
6. 预发环境补测：Postgres/Redis/pgvector 可达、`/api/health` `/api/health/ready`、worker 起、真实链路 smoke；
7. 保持 app `replicas:1`；未满足 k8s 清单头三条扩容前置条件前**勿扩容**。

## 8. 残留风险与后续里程碑（不阻断本次单实例上线）

| 级 | 项 | 补偿措施 / 计划 |
|:--:|----|----------------|
| 🟡 | F5/S4 读路径内存态（apikey/jti 撤销 per-instance） | `replicas:1` + 单容器蓝绿；**扩容前必须落地**（ADR-0006） |
| 🟡 | 队列背压 X5/X6（无深度上限，1Gi limit → OOMKilled 风险） | RB-03 人工巡检；临时降并发/提内存；单独立项 |
| 🟡 | 依赖 CVE 未审计 | `pnpm audit` 入 CI |
| 🟢 | 索引 D8、F14/F15/F18、ADR-0003/0004 | 单独立项（阶段 2） |
| ⚠️ | **渲染隔离语义待人类决策**：公开 KB 当前取"同租户可读"（`graph/route.ts:21` 硬校验） | 若产品需"跨租户公开只读"则需架构决策；建议在 ADR 显式记录当前语义 |
| 🟢 | F17 CORS 无单元测试（仅 infra smoke 覆盖）；`test-integrations.ts:14` 注释过时 | 补 `corsHeaders` 四态纯函数单测；注释改 `pnpm build && pnpm start` |

## 9. 证据来源与成员产出索引

| 产出 | 路径 |
|------|------|
| QA 门禁独立验证报告（§1–§7，含 http 组复跑实测） | `deliverables/software-company/qa-launch-check-2026-10-08.md` |
| 架构师复核报告（§1–§8，含逐脚本根因初判） | `deliverables/software-company/arch-launch-check-2026-10-08.md` |
| 主理人 CI 交叉分析 | GitHub run `36709923366`（jobs `109869000621` / `109869000497`）全量日志 |
| 历史对照 | `deliverables/engineering-assurance/pre-deploy-go-no-go-knowledgeai-2026-09-30.md` |

**体检流程环保说明**：两成员全程未修改业务代码、未动 git 状态；`.env.local` 经备份-恢复且 md5 字节一致；临时探测文件已清理；`.next/coverage/.report` 均 gitignore。

---

> 本报告由 software-kai-launchcheck 团队 AI 协作生成（主理人汇编，QA/架构师独立验证），关键决策请由人类工程负责人复核。
