# KnowledgeAI 上线前全检报告（Pre-Launch Check）

**日期**：2026-08-20
**场景**：上线前全检（代码审查 + 安全审计 + QA 测试）
**参与成员**：产品官（代码审查）+ 安全卫士（OWASP+STRIDE）+ 质量门神（QA 测试与发布）
**目标项目**：KnowledgeAI（/Users/w/Project/KnowledgeAI，Next.js 16 + TS + Prisma，main @ c5ca9fa）

---

## 📌 TL;DR（执行摘要）

- 整体结论：🟡 **有条件通过（Conditional Go）——必须先修复 7 个 P0 阻塞项再放行**
- 阻塞项数量：**7 项 P0**（1 项依赖 CVE + 4 项认证/越权/SSRF + 1 项密钥体系 + 1 项 docs 构建门禁）
- 正面事实：应用代码全部门禁绿——单测 299/299、集成 80/80、E2E 4/4、性能通过、GitHub CI 实测 success；JWT 用 jose、PBKDF2-100k、AES-256-GCM、HMAC 审计链、无 SQL 拼接/命令注入
- 补充：QA 收尾阶段复现并确认 **计费付费墙绕过（P1-13）**，0 支付可自封 enterprise 套餐——已并入本报告
- 下一步：按 §4 行动清单先修 P0 → 全量回归 → 蓝绿发布；中危项排入首个迭代

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 **条件 Go**（修复 7 个 P0 后 Go；若发布范围不含 docs 重构可提前 Go 但必须修依赖/认证类 P0） |
| 严重度分布 | 🔴 P0×7 / 🟠 高（P1）×11 / 🟡 中×11 / 🟢 低×10（去重合并后） |
| 关键行动项 | 7 条（§4） |
| 建议负责人 | 工程负责人（安全官/质量门神复核） |

---

## 1. 各成员核心结论

### 🔍 产品官（代码审查，review skill 7 专家框架）
- 核心判断：**有条件通过（5 个 P0）**。代码整体质量高：分层清晰、注释详尽、错误处理意识强、SSE 事件名与测试约束良好。
- 关键建议：先修 5 个 P0——① 聊天 IDOR（`chat/ask.ts:107` 无归属校验）；② API Key 用 `Math.random()` 生成（非 CSPRNG）；③ 上传 URL SSRF（`rag/fetcher.ts:32` 无私网拦截）；④ `hydrateApiKeys` 读不存在的 `r.secret` 列（DB 模式重启后全部存量密钥失效）；⑤ AUTH_SECRET 硬编码兜底。另有 25 项高/中/低问题（hydration 并发竞态、webhook scope、PPTX zip-bomb、Stripe webhook 非幂等、断连不取消 LLM 计费等）。

### 🛡️ 安全卫士（OWASP Top 10 + STRIDE + pnpm audit）
- 核心判断：**不通过（须先修复 P0/P1 再放行）**。1 个 P0 依赖漏洞 + 6 个 P1 应用层高危；基础安全设计扎实（jose JWT、PBKDF2-100k、AES-256-GCM 加密 API key/模型密钥、HMAC 审计链、Stripe 签名校验、多级限流、RBAC guard、Markdown 默认转义）。
- 关键建议：F-01 升级 next ≥16.2.11（Turbopack 中间件绕过可打穿限流/鉴权）；F-02 生产强制 AUTH_SECRET；F-03 聊天 IDOR；F-05 上传 SSRF；F-09 webhook 出站内网阻断；F-04 workspace 隔离。

### ✅ 质量门神（QA 测试 + 发布门禁）
- 核心判断：**有条件通过（Conditional Go）**。已提交应用代码全部门禁绿（单测 299/299、功能 25/25、API 55/55、E2E 4/4、性能通过、CI success）。
- 关键建议：P0-1 修复未跟踪文件 `scripts/tools/check-docs-frontmatter.ts` 的 7 个 TS 类型错误（docs 重构合入则 quality job 必红）；建议 `eslint.config.mjs` 忽略 `.vitepress/**`；处理水合 mismatch（中）、CORS Vary 头（低）。
- **收尾更正**：缺陷 #3（checkout 不校验 plan 枚举）经与安全官交叉确认 + 端到端复现，**由中危升级为高危（P1-13 计费付费墙绕过）**——simulate-pay 端点无支付状态校验，任意登录用户可 0 支付自封 enterprise 套餐、写入任意 plan 字符串。安全官同步记为 F-21，本报告已合并去重。

> 三份产出交叉印证：AUTH_SECRET 兜底、聊天 IDOR、上传 SSRF、API Key 弱随机、CORS 回显 均为 2~3 名成员独立发现，可信度高。

---

## 2. 综合审查发现（去重合并后按严重度排序）

### 🔴 P0 阻塞项（上线前必须解决，7 项）

| # | 严重度 | 类别 | 位置 | 问题描述 | 影响 | 修复建议 | 来源 |
|---|--------|------|------|---------|------|---------|------|
| P0-1 | 🔴 | A06 依赖 | package.json:39（next 16.2.10） | **Next.js 16.2.10 含 4 高+4 中 CVE**（Turbopack Middleware/Proxy 绕过、Server Actions SSRF×2、Image DoS、缓存混淆等），修复版 16.2.11 | 本项目启 Turbopack 且 proxy 承担限流/鉴权，绕过可直接打穿 | 升级 next ≥16.2.11 + 全量回归 | 安全卫士 |
| P0-2 | 🔴 | A05/A02 密钥 | session.ts:11, crypto.ts:21, audit.ts:63 | **AUTH_SECRET 未配置时静默回退公开硬编码密钥**（JWT 签名/AES/审计 HMAC 共用） | 生产漏配 = 任意账号可伪造、API Key/2FA/模型密钥全部可解 | 生产（NODE_ENV=production）缺 AUTH_SECRET 启动即抛错；demo 保留回退但打 warn | 安全卫士 + 产品官 |
| P0-3 | 🔴 | A01 IDOR 越权 | chat/ask.ts:107-108, store.ts:69-71 | **/api/chat 未校验 conversationId 归属**：传他人会话 ID 可经 LLM 上下文套取私聊历史、注入消息、regenerate 删除他人消息（对比 conversations/[id] 路由有 owns() 校验） | 跨用户数据泄露 + 篡改，跨租户严重漏洞 | 使用前校验 `conv.userId === u.id && conv.workspaceId === u.workspaceId`；共享会话用 canViewKb 复核 | 安全卫士 + 产品官 |
| P0-4 | 🔴 | A10 SSRF | rag/fetcher.ts:28-67（上传网页链接） | 用户 URL 直接 fetch，无内网 IP 阻断、跟随重定向 | 任意注册用户可打 169.254.169.254/localhost/内网，抓取内容经 chat 检索外带 | 解析→校验目标 IP 非私网/回环/链路本地（防 DNS rebinding）→按 IP 连接；重定向逐跳校验 | 安全卫士 + 产品官 |
| P0-5 | 🔴 | 功能/DB 一致性 | db/hydrate.ts:820 vs persist.ts:229 vs schema.prisma:236 | `persistApiKey` 把加密 secret 写入 keyHash 列，但 `hydrateApiKeys` 读不存在的 `r.secret` 列（cast 骗过类型检查，运行时 undefined） | DB 模式重启后全部 API Key secret 失效，用户必须重建 | hydrate 改读 r.keyHash；补"创建→重启→验证"集成测试 | 产品官 |
| P0-6 | 🔴 | A02 弱随机 | apikeys/store.ts:18-22 及全仓 15+ 处 uid() | **API Key 用 Math.random() 生成**（可预测）；conv/doc/kb/task 等 ID 同样（安全官定级 P1，产品官定级 P0，合并按 P0） | 攻击者可预测/碰撞密钥，伪造 kai_sk_* 完整接管 API | 改用 `crypto.randomBytes(32).toString("base64url")`；全仓 uid() 统一 CSPRNG | 产品官 + 安全卫士 |
| P0-7 | 🔴 | 构建门禁 | scripts/tools/check-docs-frontmatter.ts:60-68（未跟踪） | 7 个 TS 类型错误（value: unknown 未收窄），文件未提交但 docs job 依赖其存在 | 一旦随 docs 重构提交，CI quality job 的 tsc/build 必红 | 显式类型声明并窄化；提交前跑 npx tsc --noEmit | 质量门神 |

### 🟠 高（P1，首个迭代必须处理，11 项）

| # | 严重度 | 类别 | 位置 | 问题描述 | 影响 | 修复建议 | 来源 |
|---|--------|------|------|---------|------|---------|------|
| P1-1 | 🟠 | A01 跨租户 | team/store.ts:217-233 + documents/[docId]/route.ts + upload + kb/events | canViewKb/canEditKb 无 workspace 维度，文档/上传/SSE 路由未隔离，默认 access=view | 跨工作空间读写 | 增加 workspace 维度校验 | 安全卫士 |
| P1-2 | 🟠 | A04 DoS | agent/run-handler.ts:21-131 | /api/agent/run 在 SKIP_PATHS 且 route 内无限流 | 任意登录用户无限触发昂贵 LLM 任务（成本 DoS） | 增加 agent 专属限流/配额 | 安全卫士 |
| P1-3 | 🟠 | A07 会话 | security/store.ts:242-254 + session.ts | 会话撤销只删内存记录不吊销 JWT（无 jti） | 被盗 token 7 天内持续有效 | JWT 加 jti + 黑名单 | 安全卫士 |
| P1-4 | 🟠 | A10 SSRF | v1/webhooks/route.ts:48 + queue/handlers.ts:178 | webhook URL 仅校验 http/https，可向用户可控内网地址 POST | 服务器被诱导打内网服务（HMAC 只保完整性不保目标副作用） | 复用 P0-4 私网 IP 校验逻辑 | 安全卫士 + 产品官 |
| P1-5 | 🟠 | A06 依赖 | 依赖树 | postcss 任意文件读、sharp/libvips、nanoid 死循环、deepmerge-ts 栈耗尽（生产依赖） | 依赖层风险 | postcss ≥8.5.18、sharp ≥0.35.0、nanoid ≥3.3.18、deepmerge-ts ≥8.0.0 | 安全卫士 |
| P1-6 | 🟠 | 权限/Scope | auth/guard.ts:66-72 + api/admin/* | getRequestUser 对所有路由接受 kai_sk_ Bearer 并按 key 属主解析；legacy 管理路由不做 scope 校验 | 管理员名下仅 kb:read scope 的 key 可调 /api/admin/* | legacy 内部路由拒绝 API Key（仅 JWT）；v1 保留 scope 路径 | 产品官 |
| P1-7 | 🟠 | 权限/Scope | api/api-keys/route.ts:29 | createKey 的 scopes 未与白名单比对，任意字符串入库 | 用户自签任意 scope（如 webhooks:write）扩大越权面 | 过滤到 SCOPES 白名单 | 产品官 |
| P1-8 | 🟠 | 权限/RBAC | api/v1/webhooks/route.ts:36-70 | 仅 requireApiKeyScope，JWT 会话直接放行无角色检查 | VIEWER 也能创建/读取 webhook 订阅 | 增加 requireRole(["owner","admin","editor"]) | 产品官 |
| P1-9 | 🟠 | 并发/竞态 | db/hydrate.ts:29-104 + proxy.ts:91 | ensureHydrated fire-and-forget 无 in-flight 去重；首个请求并发时多次 hydrate | 密钥/通知内存重复 N 份（并发首屏必现） | 模块级 Promise 记忆化 + 按 id 去重 | 产品官 |
| P1-10 | 🟠 | 异常路径 | db/hydrate.ts:46-104 | 子 hydrator catch 吞错返回 0，外层仍置 _hydrated=true | 某表瞬时失败后该模型进程生命周期内静默缺失且永不重试 | 关键模型失败保持 _hydrated=false 重试 | 产品官 |
| P1-11 | 🟠 | A04/A07 计费 | billing/checkout/route.ts:16-19 + checkout/[id]/route.ts + billing/store.ts:316-378 | **计费付费墙绕过**：simulate-pay 端点无支付网关/会话态校验即调 payOrder；checkout 对 plan 无运行时枚举校验。复现：POST checkout {"plan":"enterprise"} → 201 且 amount=0 → simulate-pay → success，订阅直接变 enterprise/active；{"plan":"nonexistent-plan"} 也可支付，任意字符串写入 subscription.plan | 任意登录用户 0 支付自封 enterprise（无限问答/Agent/API/SDK/团队席位），金额 0；生产 Stripe 模式同样可走通（唯一缓解是归属校验不能替他人付款） | simulate-pay 仅 demo/!isPaymentEnabled() 可用（或由 mock 支付开关门控）；checkout 对 plan 白名单校验（free/pro/enterprise）；生产支付成功以 Stripe webhook 为准 | 质量门神（升级）+ 安全卫士 F-21 |

### 🟡 中（11 项，排入后续迭代）

| # | 类别 | 位置 | 问题 | 修复建议 | 来源 |
|---|------|------|------|---------|------|
| M-1 | 功能/一致性 | persist.ts:40-49 + hydrate.ts:215 | persistUser 不收 plan，hydrateUser 恒为 free → 付费功能误降级 | persist/hydrate 带 plan | 产品官 |
| M-2 | 权限/功能 | agent/run-handler.ts:34-36 | agent run 要求 kb.ownerId === user.id，成员无法对共享 KB 跑 Agent | 改为 canViewKb/canEditKb | 产品官 |
| M-3 | 架构/性能 | upload/route.ts:125 + kb/store.ts:161-169 | 文档解析/OCR 在请求线程同步执行；processDocInQueue 仅模拟 tick，与 AGENTS"后台队列"不符 | parse 移入 doc-process 队列；req.formData() 分块处理防 OOM | 产品官 |
| M-4 | 资源泄漏 | queue/memory-queue.ts:33 | jobs Map 永不移除，job+payload 常驻内存 | 完成后保留最近 N=100 条 | 产品官 |
| M-5 | 配置失效 | rate-limit.ts:21-25 + schema.prisma:354 | admin SystemConfig.rateLimitPerMin 与 limiter 无关，运行时改 env 不生效 | 统一从 config 读取 | 产品官 |
| M-6 | 一致性 | apikeys/store.ts:100-113 | logCall 只改内存不写回 DB，重启后调用计数回退 | 节流写回 | 产品官 |
| M-7 | 一致性/权限漂移 | team/store.ts:195-207 | setKbMemberRole 只 persistTeam，kbMemberRoles 从不落库/hydrate | 存进 team 行 JSON 并 hydrate | 产品官 |
| M-8 | 功能 | agent/store.ts:66-68 | deleteTask 仅删内存无 DB 删除，重启后复活 | persist 加 deleteAgentTaskFromDb | 产品官 |
| M-9 | 安全/DoS | rag/parser.ts:276-330 | PPTX 手写 ZIP zlib.inflateSync 无解压上限（zip bomb → worker OOM） | 限制解压字节数 + 按大小/文件名去重 | 产品官 |
| M-10 | 资源/成本 | chat/ask.ts:248 + rag/generator.ts:219 | 客户端断开后 generateStream 未取消底层 LLM fetch | 传 AbortSignal，断连即 abort | 产品官 |
| M-11 | 幂等 | billing/webhook/route.ts:20-30 | Stripe webhook 重试重复执行 payOrder（内存不幂等） | payOrder 加 order.status==="paid" 短路 | 产品官 |
| M-12 | 租户隔离 + 水合 | team/route.ts:27（listAllKbs 无 workspace）+ /chat page.tsx:961（水合 mismatch） | 团队页跨租户泄露；核心页水合告警（sttSupported 客户端唯一值控制 DOM） | 传 workspaceId 过滤；useEffect+mounted 判定 | 产品官 + 质量门神 |

### 🟢 低（10 项，排期跟进）

| # | 类别 | 位置 | 问题 | 修复建议 | 来源 |
|---|------|------|------|---------|------|
| L-1 | 安全 | proxy.ts:170-177 | CORS 回显任意 Origin，Vary 缺 Origin（当前无 credentials 头不可直接利用，但缓存/CDN 场景有风险） | ACAO 白名单化 + 补 Vary: Origin | 三方一致 |
| L-2 | 安全 | agent/store.ts + doc-share.ts | 分享密码无盐 SHA-256，弱密码可离线爆破 | 随机盐 + PBKDF2/scrypt | 产品官 + 安全卫士 |
| L-3 | 功能/UX | upload/route.ts:116-133 | parse 失败 content 为空仍置 ready + 通知"成功" | 置 failed + 错误信息 | 产品官 |
| L-4 | 存储 | storage/index.ts:72 | saveFile 本地 URL 悬空（/api/files/ 无路由）；原始文件 7 天被清且 doc.url 不引用 | 明确保留策略或挂文件服务路由 | 产品官 |
| L-5 | 一致性 | persist.ts:297-311 | persistConversation 只写最后一条，并发问答丢历史 | 消息级 upsert 队列 | 产品官 |
| L-6 | 配置 | rate-limit.ts:122 | Redis retryStrategy null，断连一次永久降级内存限流（多实例限额×N） | 降级加告警或有限重连 | 产品官 |
| L-7 | 构建卫生 | storage/s3.ts:78 + next.config.ts:12 | @aws-sdk optional 依赖未装，build 告警噪音 | 移入 optionalDependencies 或 externals | 质量门神 |
| L-8 | 功能/校验 | api/api-keys/route.ts:29 | 空 name 静默替换默认名、空 scopes 放行 | 空名返回 400 | 质量门神 |
| L-9 | 维护性 | bullmq-queue.ts:47 + proxy.ts:95 | 死代码：构造函数存未用字段、parseRedisUrl 三处重复、!startsWith 死分支 | 收敛清理 | 产品官 |
| L-10 | 安全加固 | 缺 CSP、登录无账户锁定、compose 默认 DB 口令/Redis 无认证、obs/report 匿名上报 | 按安全官 F-11~F-20 排期 | 安全卫士 |

---

## ✅ 行动清单（7 条 P0 优先）

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | 升级 next ≥16.2.11 并全量回归（P0-1） | 工程负责人 | P0 | 上线前 |
| 2 | 生产强制 AUTH_SECRET，缺省启动即拒（P0-2） | 工程负责人 | P0 | 上线前 |
| 3 | 修复聊天 IDOR：conversationId 归属校验（P0-3） | 后端 | P0 | 上线前 |
| 4 | SSRF 防护：上传 URL + webhook 出站私网 IP 阻断（P0-4/P1-4） | 后端 | P0 | 上线前 |
| 5 | API Key 体系：CSPRNG 生成 + hydrate 读 keyHash 列修复（P0-5/P0-6） | 后端 | P0 | 上线前 |
| 6 | 修复 check-docs-frontmatter.ts TS 错误 + eslint 忽略 .vitepress（P0-7） | 前端/docs | P0 | docs 合入前 |
| 7 | 修复计费付费墙绕过：simulate-pay 仅 demo 可用 + plan 白名单校验 + 生产以 Stripe webhook 为准（P1-11） | 后端 | P0* | 上线前* |
| 8 | 中危批处理：workspace 隔离、agent 限流、JWT jti 吊销、hydration 去重、水合 mismatch、zip-bomb 限制（P1/M 清单） | 工程负责人排期 | P1 | 首个迭代 |

> *P1-11 计费绕过影响收入与权益提权，虽归 P1，建议与 P0 同批修复（QA 与安全官均建议）。

---

## 🔄 回滚预案（上线前检查必备）

1. **依赖升级（P0-1）**：next 升级为单一 commit，构建产物为 standalone，可一键回退旧镜像；升级前锁定 pnpm-lock.yaml。
2. **发布方式**：沿用 scripts/deploy/blue-green.sh 蓝绿发布；GitHub CI + Deploy Staging 已实测绿（HEAD c5ca9fa）。
3. **DB 变更**：本次修复以代码层为主；若引入 schema 变更，先 `prisma migrate diff --exit-code` 校验再迁移，迁移前备份，失败即停。
4. **配置类（AUTH_SECRET）**：先在 staging 验证启动守卫，再灰度生产；配置错误可回退配置不涉及代码。
5. **快速排障**：DATABASE_URL/REDIS_URL 门控，可临时切回 demo 模式定位问题。

---

## ⚠️ 待完善 / 已知局限

- 安全审计为**源码级只读**，未做实际 exploit；所有高危项经源码复核但需修复后复验。
- QA 性能基准为 **demo 模式（内存存储）** 数据（首屏 SSR 150-211ms 为 dev 冷编译特性）；生产 DB 模式需 `next start` + CDN 复测。
- 本地 Postgres/Redis 未运行：DB 模式相关行为（P0-5 API Key 重启失效）基于代码走查推演，需补"创建→重启→验证"集成测试实证。
- 浏览器兼容性仅验证 Chromium（Playwright 默认）；Safari/Firefox/移动端未实测。
- lint 红（1072 errors）100% 来自本地未忽略的 `.vitepress` 产物，干净 CI checkout 无此问题——但需通过 gitignore/eslint ignore 固化。
- 依赖审计基于 pnpm audit 当前库快照，上线前需重跑确认无新增 CVE。

---

## 📚 成员产出索引

- gstack-security-officer（安全卫士）原始产出：`/tmp/KnowledgeAI-security-audit-2026-08-20.md`（F-01~F-20 + pnpm audit 明细）
- gstack-product-reviewer-2（产品官）原始产出：代码审查报告 30 项（P0×5 + 高/中/低×25，含行号）——本会话回传
- gstack-qa-lead（质量门神）原始产出：`tests/functional/功能测试报告.md`、`tests/api/接口测试报告.md`、`tests/performance/性能测试报告.md`

---

> 本报告由软件工坊 AI 协作生成（产品官 + 安全卫士 + 质量门神），关键决策请由工程负责人复核。
