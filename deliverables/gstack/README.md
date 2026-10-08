# KnowledgeAI 2026-08 缺陷修复纪要（gstack 批次 · 整合摘要）

**日期**：2026-08-20 ~ 08-21（整合于 2026-10-08）
**来源**：原 5 份记录（`pre-launch-check` + `p0-fix` / `p1-fix` / `m-fix` / `l-fix`）整合而成；原文已随 2026-10-08 文档治理清理，全文可在 git 历史中检索。
**背景**：上线前全检（代码审查 + OWASP/STRIDE 安全审计 + QA 测试）发现 39 项问题，全部当轮修复并验证。

## 全检结论（pre-launch-check）

- 结论：🟡 **条件 Go**——先修复 7 个 P0 阻塞项再放行
- 严重度分布（去重后）：P0×7 / P1×11 / M×11 / L×10（另有 1 项独立 QA 复现的计费绕过并入 P1-11 升级处理）
- 三方交叉印证的可信发现：AUTH_SECRET 硬编码兜底、聊天 IDOR、上传 SSRF、API Key 弱随机、CORS 回显

## 修复要点（按主题）

| 主题 | 内容 |
|------|------|
| 依赖 CVE | `next` 16.2.10 → 16.2.11（Turbopack 中间件绕过等） |
| 密钥体系 | 生产强制 `AUTH_SECRET`（`src/lib/secrets.ts`，缺省拒绝启动；demo 保留回退 + warn） |
| 聊天 IDOR | conversationId 归属校验（属主 / 共享会话 / workspace 三重条件，`chat/ask.ts`） |
| SSRF | 新增 `src/lib/security/ssrf.ts`（私网/回环/链路本地/LinkLocal 阻断 + 全量 DNS 解析防 rebinding）；上传网页抓取（逐跳重校验）与 webhook 出站接入 |
| API Key 体系 | CSPRNG 生成（`src/lib/ids.ts`，替换 15 处 `Math.random()`）+ hydrate 读 `keyHash` 修正（重启不再失效）+ createKey scope 白名单 + 调用计数节流写回 |
| 计费 | 付费墙绕过修复：plan 白名单校验 + `simulate-pay` 生产（Stripe 启用时）403 + `payOrder` 幂等短路 |
| 租户隔离 | `canViewKb/canEditKb/canViewDoc/canEditDoc` 增加 workspace 维度（22 个路由调用点更新） |
| 会话安全 | JWT `jti` + 吊销黑名单（4 个登录入口）；账户锁定（5 次失败 / 15 分钟）；CSP 头 |
| 后台任务 | agent 专属限流（`RATE_LIMIT_AGENT_PER_MIN`，默认 10/min）；hydration in-flight 记忆化 + 吞错重试；消息级 upsert（并发不再丢历史） |
| 数据一致性 | `User.plan` 持久化、`Team.kbMemberRoles` 落库（migration `20260820230000_m7_kb_member_roles`）、`deleteTask` 同步删 DB 行 |
| 解析安全 | PPTX zip-bomb 上限（1MB `maxOutputLength`）；分享密码 PBKDF2-100k（兼容旧哈希） |
| 其他 | Redis 有限重连自愈、`@aws-sdk` optional 声明、死代码清理、useSpeechRecognition 水合 mismatch、`/api/files/[key]` 下载路由（防路径穿越） |

## 验证结论（当轮）

- `tsc --noEmit` 0 错误 · 单测 **307/307** · `pnpm lint` 0 errors · `next build` 通过 · `prisma validate` 通过
- 运行时实测：非法 plan 400 / 内网 webhook 400 / 跨用户会话 403 / 撤销后旧 token 401 / admin 接口拒绝 API key / agent 配额 429 等

## 历史评估（2026-10-08 文档治理时标注）

- 本批修复成果已并入主干；后续两轮审计（2026-09-30 工程保障、2026-10-08 上线体检）在此基础上继续推进；
- 当轮遗留项均在后续处置：workspace 隔离从"可选参数"→ **必填化**（2026-09-30）、JWT 黑名单内存态 → 靠 `replicas:1` 单实例规避（ADR-0006）、依赖 CVE 治理 → 2026-10-08 全量清零 + CI 审计门禁。
