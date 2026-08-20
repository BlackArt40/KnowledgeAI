# KnowledgeAI P1 缺陷修复记录（2026-08-20）

**依据**：`deliverables/gstack/pre-launch-check-knowledgeai-2026-08-20.md`（上线前全检报告 P1 清单）
**范围**：P1-1~P1-10（P1-4 webhook SSRF、P1-11 计费绕过已在 P0 轮完成，不重复）
**验证**：`npx tsc --noEmit` ✅ · 单测 307/307 ✅ · `pnpm lint` 0 errors ✅ · `next build` ✅ · 运行时实测见下

---

## 修复明细

### P1-1 跨租户隔离（A01）
- `src/lib/team/store.ts`：`canViewKb/canEditKb` 增加可选 `opts?: { callerWorkspaceId, kbWorkspaceId }`——两者均提供时 workspace 不一致直接拒绝（tenant boundary 下沉到权限函数本身）
- `src/lib/kb/store.ts`：`canViewDoc/canEditDoc` 增加 `callerWorkspaceId` 参数并透传 KB workspace
- **22 个路由调用点批量更新**：documents/[docId]、upload（含 chunk）、kb/events、conversations（含 shared/events/feedback）、v1/knowledge-bases、v1/integrations（confluence/notion/bot）、search、recommend、graph 等全部传入 `{ callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }`

### P1-2 agent run 成本 DoS（A04）
- `src/lib/rate-limit.ts`：新增 agent 专属档位 `RATE_LIMIT_AGENT_PER_MIN`（默认 **10 次/分**，远低于 API 档）+ `agentRateLimit(userId)` + kind 识别
- `src/lib/agent/run-handler.ts`：`handleAgentRun` 在解析 body / 创建任务**之前**强制限流（SSE 路径 proxy 跳过，必须 route 内拦截），429 用 `rateLimitResponse`

### P1-3 JWT 吊销（A07）
- `src/lib/auth/session.ts`：`createToken` 新增 `opts.jti`（默认 randomUUID）；`verifyToken` 检查 jti 黑名单（`globalThis.__KAI_REVOKED_JTI__`，8 天 TTL）；导出 `revokeJti/isJtiRevoked`
- `src/lib/security/store.ts`：`revokeSession/revokeAllSessions` 把被删会话 id（= jti）加入黑名单
- 4 个登录入口把 `sessions[0].id` 作为 jti 传入：login / oauth-bridge / 2fa-enroll / **register**（补 addSession）
- Edge proxy 的 verifyToken 仅用于限流定级（isolate 隔离无黑名单数据），授权在 Node 侧 getRequestUser 强制——安全边界闭合
- 新增单测：jti 吊销后 token 立即失效、其他 token 不受影响

### P1-5 依赖 CVE（A06）
- `pnpm-workspace.yaml` 增加 `overrides`（pnpm 11 配置已迁移至此）：
  - `sharp: ^0.35.0`（0.34.5 → **0.35.3**，libvips）
  - `deepmerge-ts: ^8.0.0`（7.1.5 → **8.0.1**，栈耗尽）
  - `nanoid@<3.3.18: ^3.3.18`（3.3.15 → **3.3.18**，ReDoS）
  - `postcss: ^8.5.18`（8.4.31 → **8.5.26**，任意文件读）
- 移除 package.json 中无效的 `pnpm` 字段（pnpm 11 不再读取）

### P1-6 管理路由 API Key 鉴权
- `src/lib/auth/guard.ts`：`getRequestUser` 增加 `opts.allowApiKey`（默认 true 保持兼容）；新增 `getRequestUserJwtOnly` + `requireRoleJwt`
- **11 个 /api/admin/\* 路由**改用 `requireRoleJwt`——API key 一律 401（此前管理员名下 kb:read key 可调 admin 接口）

### P1-7 createKey scopes 白名单
- `src/app/api/api-keys/route.ts`：POST 校验 scopes 全部 ∈ SCOPES 白名单（非法 400），空 name 返回 400（顺带 L-8）

### P1-8 webhook RBAC
- `api/v1/webhooks/route.ts` + `[id]/route.ts` 共 5 个 handler：JWT 会话需角色 ∈ owner/admin/editor（VIEWER 403）；API key 仍走 `webhooks:write` scope

### P1-9 hydration 并发竞态
- `src/lib/db/hydrate.ts`：`ensureHydrated` 增加模块级 in-flight Promise 记忆化（`_hydrating ??=` + `.finally` 重置），并发首请求只跑一次 hydrate

### P1-10 hydrate 吞错重试
- 12 个扩展 hydrator（convs/models/notifs/team/systemConfig/audit/keys/billing/workspaces/webhooks/bots/kg）的 catch 从 `return 0/false` 改为 **`throw err`**——瞬时失败传播到 `hydrateFromDb` 外层，`_hydrated` 保持 false，下次请求重试（此前进程生命周期内静默缺失）

---

## 回归验证

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx vitest run` | ✅ 307/307（新增 P1-3 jti 吊销用例） |
| `pnpm lint` | ✅ 0 errors / 25 存量 warnings |
| `pnpm build`（next 16.2.11 + sharp 0.35.3） | ✅ 通过 |

### 运行时实测（生产模式 next start）

| 场景 | 结果 |
|---|---|
| P1-7 创建 key 带非法 scope | ✅ 400 |
| P1-6 API key 调 /api/admin | ✅ 401（key 不再被接受） |
| P1-8 viewer 创建 webhook | ✅ 403 |
| P1-3 撤销会话后旧 token 调 /api/security | ✅ 401（新 token 200） |
| P1-2 agent/run 第 4 次请求（配额 3/min） | ✅ 429 |

> 注：`/api/auth/me` 对未认证恒返回 200（`{user:null}` 设计），验证认证态需用需登录端点。

## 遗留 / 后续

- M 级清单（workspace 页隔离、hydration 幂等、zip-bomb 限制、SSE 断连取消 LLM 等）排入后续迭代
- jti 黑名单为内存实现（与既有会话体系一致）；多实例部署如需跨实例吊销，建议后续接入 Redis
- 集成/E2E 全量回归建议在 CI（干净 checkout）执行
