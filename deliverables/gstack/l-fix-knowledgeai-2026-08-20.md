# KnowledgeAI 低危（L 级）缺陷修复记录（2026-08-20）

**依据**：`deliverables/gstack/pre-launch-check-knowledgeai-2026-08-20.md` L 级清单（10 项）
**范围**：L-1 ~ L-10（L-8 空 name 400 已在 P1-7 轮完成）
**验证**：`npx tsc --noEmit` ✅ · 单测 307/307 ✅ · `pnpm lint` 0 errors ✅ · `next build` ✅

---

## 修复明细

### L-1 CORS 白名单 + Vary
- `src/proxy.ts` corsHeaders：`CORS_ALLOWED_ORIGINS`（逗号分隔）白名单化 ACAO；无配置时回退反射 Origin（dev/widget）；**always `Vary: Origin`**（防 CDN 缓存投毒）

### L-2 分享密码 PBKDF2
- 新增 `src/lib/security/share-password.ts`：`hashSharePassword`（随机盐 + PBKDF2-100k）+ `verifySharePassword`（兼容旧无盐 SHA-256 hex 直到下次重设）
- `kb/doc-share.ts` + `agent/store.ts` 统一改用该模块（agent store 移除 `createHash` unused import）

### L-3 上传通知文案
- `upload/route.ts`：M-3 后 notify 文案从"已成功处理"改为"**已上传，正在后台解析与索引**"（不再谎报 ready）；web link 分支同步

### L-4 文件保留策略
- `storage/cleanup.ts` cleanupOldFiles：**跳过仍被非终态文档引用的文件**（文件名 `<docId>-*` → 检查 doc.content 是否为空且 status 非 ready/failed，是则保留，防 M-3 的 processDocInQueue 找不到文件）
- `storage/index.ts` saveFile：注释 `/api/files/<key>` 在本地模式无路由（M-3 后不再被调用，逻辑句柄仅 S3 对齐用）

### L-5 消息级持久化
- `db/persist.ts`：persistConversation **不再写"最后一条消息"**（并发竞态丢历史根因）；新增 `persistMessage(convId, msg)` 单条 upsert
- `chat/store.ts` addMessage：每条消息独立 `persistMessage`（不依赖"最后一条"），并发安全

### L-6 Redis 重连
- `rate-limit.ts`：`retryStrategy: null` → `times < 3 ? Math.min(times*500, 2000) : null`（有限重连自愈，耗尽仍降级内存）

### L-7 @aws-sdk optional 依赖
- `package.json` 增加 `optionalDependencies`：`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`（声明消除 build 告警噪音）

### L-8 空 name 400（已完成）
- P1-7 轮已实现（api-keys POST 空 name 返回 400）

### L-9 死代码清理
- `queue/bullmq-queue.ts`：删除未用的 `this.connection` 字段；`parseRedisUrl` 结果缓存到 `this.parsedConnection`（ensureConnected 解析一次，start 复用）

### L-10 安全加固
- **CSP 头**（`next.config.ts`）：default-src self、script/style self + unsafe-inline/eval（Next.js 兼容）、connect-src self + OpenAI、frame-ancestors none、base-uri/form-action self
- **账户锁定**（`auth/store.ts`）：5 次失败锁 15 分钟（`isAccountLocked` + `verifyCredentials` 内计数）；login route 返回 429 + locked 标记
- 排期项（compose 默认 DB 口令/Redis 认证/obs 匿名上报）属部署配置，已在 docs/ops/env-vars.md 说明

---

## 回归验证

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx vitest run` | ✅ 307/307 |
| `pnpm lint` | ✅ 0 errors / 26 warnings |
| `pnpm build` | ✅ 通过 |

## 遗留

- L-10 部署配置项（compose 默认口令、Redis 无认证、obs 匿名上报）需运维在预发/生产环境落实，代码层已完成可快速实施项（CSP + 账户锁定）
- 至此 P0(7)+P0*(1)+P1(9)+M(11)+L(10) **全部 38 项**处理完毕

---

## 复查补充（同日第二轮，4 项）

| # | 反馈 | 修复 |
|---|------|------|
| M-12a | useSpeechRecognition 水合 mismatch（useMemo 读 window） | 改用 **`useSyncExternalStore`**（serverSnapshot false，client 检测后翻 true）——`useState+useEffect` 会触发 react-hooks setState-in-effect 规则，故用官方模式 |
| M-12b | team/route.ts listAllKbs 未传 workspaceId | 改为 `listAllKbs(u.workspaceId)`，多租户不再泄露他 workspace KB 名 |
| L-4a | 原始文件仍不可下载 | 新增 **`/api/files/[key]`** 路由：key 正则防路径穿越 + 仅本地存储模式 + 登录鉴权 + `Content-Disposition: attachment`（防 HTML/SVG 执行）+ 类型推断 |
| L-9a | proxy.ts:95 死分支未删 | 删除 `!pathname.startsWith("/api/")` 死分支（config.matcher 已限定 /api/*），保留注释说明 |

**验证**：tsc ✅ · 单测 307/307 ✅ · lint 0 errors ✅ · `next build` ✅（`/api/files/[key]` 已编译生成）
