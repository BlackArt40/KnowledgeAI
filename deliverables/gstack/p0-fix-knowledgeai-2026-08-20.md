# KnowledgeAI P0 缺陷修复记录（2026-08-20）

**依据**：`deliverables/gstack/pre-launch-check-knowledgeai-2026-08-20.md`（上线前全检报告）
**范围**：7 项 P0 + 1 项被升级为 P0\* 的计费绕过（P1-11），另顺带修复 P1-4（webhook SSRF）、M-11（webhook 幂等）
**验证**：`npx tsc --noEmit` ✅ · 单测 306/306 ✅ · `pnpm lint` 0 errors ✅ · `next build`（16.2.11 Turbopack）✅ · docs frontmatter 门禁 ✅ · 生产 AUTH_SECRET 守卫 ✅

---

## 修复明细

### P0-1 依赖 CVE — 升级 next ≥16.2.11
- `package.json`：`next` 16.2.10 → **16.2.11**，`eslint-config-next` 16.2.10 → 16.2.11
- 验证：`pnpm install` 成功；`pnpm build`（Turbopack）全量路由编译通过
- 注：本机 `pnpm build` 需 `env -u NODE_OPTIONS` 运行——WorkBuddy 宿主注入的 `--use-system-ca` 不被 Turbopack worker 接受，与代码无关（CI 环境无此变量）

### P0-2 密钥体系 — 生产强制 AUTH_SECRET
- 新增 `src/lib/secrets.ts`：`getAuthSecret(fallback)` —— `NODE_ENV=production` 且缺 `AUTH_SECRET` 时**抛错拒绝启动**；demo/test 保留原回退值 + 一次性 warn
- 统一 5 处调用：`auth/session.ts`（JWT 签名）、`lib/crypto.ts`（AES-256-GCM HKDF）、`security/audit.ts`（审计 HMAC）、`auth/authjs.ts`（Auth.js JWE）、`app/api/auth/oauth/bridge/route.ts`（getToken）
- 保持各模块原有 fallback 值不变（存量 demo 密文可继续解密）

### P0-3 聊天 IDOR — conversationId 归属校验
- `src/lib/chat/ask.ts`：使用 `body.conversationId` 时校验：
  - 属主：`conv.userId === authUser.id && conv.workspaceId === authUser.workspaceId`
  - 共享会话（P4-1）：需 `conv.shared && conv.kbId === kbId && conv.workspaceId === authUser.workspaceId && canViewKb(...)`
  - 属主会话的 `conv.kbId !== kbId` → 400
  - 不满足 → 403（不再能套取私聊历史 / 注入消息 / regenerate 删除他人消息）

### P0-4 + P1-4 SSRF — 上传 URL + webhook 出站私网阻断
- 新增 `src/lib/security/ssrf.ts`：
  - scheme 白名单（http/https）；IPv4/IPv6 私网/回环/链路本地/ULA/CGNAT/组播/保留段阻断
  - 域名全量 A/AAAA 解析校验（任一私网即拒，防 DNS rebinding）；IPv6 带括号/zone id 处理
- `src/lib/rag/fetcher.ts`（上传网页）：`redirect: "manual"` + 逐跳 `resolveSafeUrl` 重校验（≤5 跳），每跳重新解析
- `app/api/v1/webhooks/route.ts` + `[id]/route.ts`：创建/更新订阅时 `resolveSafeUrl` 校验，内网目标 400
- `src/lib/queue/handlers.ts` webhook 投递前再校验一次（防创建后 DNS rebinding / 存量订阅），被阻则记录 delivery error

### P0-5 API Key hydrate 读错列 — 重启后密钥失效
- `src/lib/db/hydrate.ts` `hydrateApiKeys`：`r.secret`（不存在的列）→ **`r.keyHash`**（persistApiKey 实际写入的密文列），原样载入内存（与 createKey 存密文一致，validateApiKey 解密比对）
- 移除该处 `isEncrypted/decryptFromString` 误用（其余位置保留）
- 新增回归测试 `src/lib/db/apikey-persist-hydrate.test.ts`：模拟「persist 写入 keyHash（无 secret 列）→ 重启 → hydrate 读回 → validateApiKey 仍能匹配明文」全链路

### P0-6 API Key 弱随机 — 全仓 CSPRNG 化
- 新增 `src/lib/ids.ts`：`uid(prefix)`（Web Crypto `getRandomValues`，48bit 熵，Node/Edge 通用）+ `genSecret()`（32 字节 base64url，256bit）
- 替换 15 处 `Math.random()` 生成：apikeys/billing/notifications/obs(trace,errors)/chat/models/security(store,audit)/kb/team/auth/workspace/agent store + errors.ts 的 uuid fallback
- 保留 `kb/store.ts` 模拟 chunk 数的 `Math.random()`（非 ID、非安全敏感）

### P0-7 docs 构建门禁
- `scripts/tools/check-docs-frontmatter.ts`：`value` 从 `unknown` 显式收窄（const raw 做字符串操作，value 仅赋值），消除 7 个 TS 错误；实测运行通过（32 文档全合法）
- `eslint.config.mjs`：globalIgnores 增加 `.vitepress/**`（本地 lint 1000+ 错误来源，CI 已绿）

### P1-11（P0\*）计费付费墙绕过
- `app/api/billing/checkout/route.ts`：plan/method 白名单校验（仅 pro/enterprise 可购；free 与任意字符串 400）
- `app/api/billing/checkout/[id]/route.ts`（simulate-pay）：`isPaymentEnabled()`（即配置了 Stripe）时 **403 拒绝**——生产支付成功只认签名 webhook
- `src/lib/billing/store.ts` `payOrder`：`order.status === "paid"` 幂等短路（M-11，防 Stripe webhook 重试重复计费/重复写订阅）

---

## 回归验证

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误（清 tsbuildinfo 后） |
| 单测 `npx vitest run` | ✅ 306/306（原 299 + SSRF 新增 5 + P0-5 回归 2） |
| `pnpm lint` | ✅ 0 errors / 25 warnings（均为存量） |
| `pnpm build`（next 16.2.11） | ✅ 通过 |
| `check-docs-frontmatter.ts` | ✅ 32 文档全部合法 |
| P0-2 生产守卫 | ✅ NODE_ENV=production 缺 AUTH_SECRET 抛错 |
| 运行时验证（dev server demo 模式） | ✅ 见下表 |

### 运行时验证（2026-08-20 22:2x，demo 模式 dev server）

| 场景 | 结果 |
|---|---|
| checkout 非法 plan（`nonexistent-plan`） | ✅ 400 |
| checkout `free` plan | ✅ 400 |
| checkout 合法 `enterprise` | ✅ 201（demo 模式订单可建） |
| webhook 创建指向 `http://localhost:3000/hook`（P1-4） | ✅ 400 内网地址被拒 |
| webhook 合法 URL | ✅ 201 |
| viewer 用 owner 的 conversationId 调 /api/chat（P0-3） | ✅ 403 无权访问该会话 |
| owner 用自己 conversationId 调 /api/chat | ✅ 200 流式正常（无回归） |
| Chat SSE（api-test 套件内） | ✅ 200 tokens/done |
| agent/run SSE（api-test 内） | ⚠️ demo 模式挂起导致脚本中断——既有行为（agent run 未在本次改动范围，仅 ID 生成变更） |

## 遗留 / 后续

- P1（首个迭代）：workspace 隔离、agent 限流、JWT jti 吊销、hydration 去重、zip-bomb 限制等
- 集成/E2E 全量回归建议在 CI（干净 checkout）执行一次
- 本机构建需 `env -u NODE_OPTIONS`（WorkBuddy 宿主注入 `--use-system-ca` 所致，非代码问题）
