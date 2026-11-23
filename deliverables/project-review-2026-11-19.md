# KnowledgeAI 项目审查报告

> **历史快照（2026-11-19）**：报告中的 `services/ai`、`services/business`、Flyway、25 个迁移和双前端描述
> 已被 2026-11-20 的单一运行时收敛取代。当前状态见 `docs/architecture/current-state.md`，本报告仅作历史记录。

- 日期：2026-11-19（第二版：在第一版静态审查基础上补齐**实测门禁**与**未覆盖区域**）
- 审查对象：`/Users/wsy/Project/KnowledgeAI`（branch `main`，tip `0e244e4`，与 `origin/main` 同步，工作树无代码改动）
- 规模：`src/app` 115 个 `route.ts`、25 个迁移、`src/lib` 121 个测试文件；另有 `frontend/`（Vue 3，31 路由）、`services/ai`（Python）、`services/business`（Java）、`sdk/`（go/python/js）、`integrations/`（chrome/vscode/widget）
- 方式：实跑门禁 + 只读代码核查

## 0. 结论

工程成熟度高于同规模项目：路由守卫覆盖完整、SSRF 与文件下载做过系统性硬化、CI 九门禁齐全、有 ADR 与验收脚本、全仓 `TODO/FIXME/HACK` 为 0。**剩余风险集中在五处结构性问题**，本次实测没有发现新的"构建/类型/测试红"。

1. Vue 接管页面后，安全响应头仍只配在 Next（已不承载页面）上，真实页面无 CSP/HSTS/XFO；
2. 进程内 store 是唯一读源，DB 写入全部 fire-and-forget，非 FK 错误只落日志；
3. 若干高频表缺索引（消息、会话、Agent 任务、KB 租户列）；
4. 租户边界靠"每个路由记得过滤"，DB 层无兜底，且已存在一处漏过滤（`/api/team`）；
5. 三分之二的运行时（`services/ai` / `services/business` / `sdk/go`）在 CI 之外，属于"无门禁区"。

| 维度 | 判断 | 依据 |
| --- | --- | --- |
| 安全 | 中 | 守卫/IDOR/SSRF/密钥哈希均已处理；页面安全头回退、`/api/team` 跨租户、租户兜底 |
| 可靠性 | 中 | 写穿不阻塞、失败可丢；缺索引放大延迟 |
| 可维护性 | 中上 | 分层清晰但边界膨胀（Next API + Vue + Python + Java + 4 个 SDK/集成） |
| 性能上限 | 未实测 | 无负载数据；仅从 schema 与代码推断 |

## 1. 实测门禁结果（本次新增）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | 通过，0 错误 |
| Lint | `pnpm lint` | 通过，0 输出 |
| 单测 + 覆盖率 | `pnpm test:unit` | 通过；实测 lines **68.47%** / statements 65.80% / functions 70.73% / branches 56.28% |
| 前端类型检查 | `pnpm -C frontend typecheck` | 通过 |
| 前端 Lint | `pnpm -C frontend lint` | 通过 |
| 前端单测 | `pnpm -C frontend vitest run` | 12 文件 / 45 用例全过 |

未跑：`pnpm build`、`test:integration`、`e2e`、`smoke`、`ai-contract`（需要起服务 / Playwright 浏览器 / Python 环境），本次不声称其通过。

## 2. 必须修（P1）

### P1-1 认证 / 工作区写入 fire-and-forget，失败即静默分叉

- 证据：`src/lib/db/persist.ts:258-279`（`withFkRetry` 只对 P2003 重试，其他错误 `log.error` 后返回 `undefined`）；`src/lib/kb/store.ts` 15 处、`src/lib/chat/store.ts` 7 处、`src/lib/auth/store.ts`、`src/lib/workspace/store.ts`、`src/lib/security/audit.ts` 等。实测计数：`grep -rn "void persist" src/lib` = **85 处**，`void (persist\|save\|delete\|update)` 合计 110 处。
- 影响：注册、改密、2FA、密码重置令牌、邮箱验证令牌、工作区成员变更，HTTP 已返回 200 而 DB 可能没落盘；进程重启后状态回退（重置链接失效、成员丢失）。多副本下另一副本读不到新写入。
- 建议：认证类写路径改为 `await`（可接受 +10~30ms）；其余至少加有界重试 + 失败计数指标，并让 `/api/health/ready` 暴露 `persistDegraded`。

### P1-2 高频表缺索引

- 证据：`prisma/schema.prisma` —— `Message`（225）、`Conversation`（209）、`AgentTask`（240）、`KnowledgeBase`（162）四个 model **均无任何 `@@index`**；对照 `KbDocument:205` 有 `@@index([kbId])`、`KbChunk:354` 有 `@@index([kbId])`，说明是遗漏而非统一策略。
- 影响：数据量到 10^5 级后会话加载（按 `conversationId`）、任务轮询（按 `status`）、租户 KB 列表（按 `workspaceId`）退化为顺序扫描；级联删除同样变慢。
- 建议：单个 migration 补齐 `Message(conversationId)`、`Conversation(workspaceId, userId)`、`AgentTask(workspaceId, status)`、`KnowledgeBase(workspaceId)`，并在 `test:db` 加一条 `EXPLAIN` 断言防回退。

### P1-3 `/api/team` 把全平台成员列表返回给任意登录用户

- 证据：`src/app/api/team/route.ts:20`（`const members = listMembers()`）→ `:60` 原样返回；`src/lib/team/store.ts:92-95` 无任何过滤（`Array.from(store().members.values())`）；`TeamMember` 模型（`prisma/schema.prisma:103-114`）**没有 `workspaceId` 字段**。
- 同一文件 `:29-31` 的注释显示作者已知 M-12 修过 `sharedKbs` 的租户泄露，但成员列表被漏掉。
- 影响：多租户部署下，任意登录用户可读到全部工作区成员的**邮箱 + 全局角色 + 活跃状态**。这是可直接利用的横向 PII 读取，且与 P1-4 同源（Team 是平台级概念，KB 是租户级概念）。
- 建议：`TeamMember` 增加 `workspaceId`（或改为按 `Workspace.members` 派生），`listMembers` 强制传租户；在越权矩阵测试里补一条"跨工作区读成员 → 空"。

### P1-4 `resolveWorkspace` 兜底回默认租户 + 新 KB 默认 `view`

- 证据：`src/lib/workspace/store.ts:152`（最后一级 `return fallback;` 无条件返回 `ws_default`）；`src/lib/team/store.ts:241`（`getKbAccess` 缺省 `"view"`）；`src/lib/kb/store.ts:527-548`（`createKb` **不写** `kbAccess`，故新 KB 一律走 `"view"` 兜底）。
- 影响：任何"无成员关系且无自有工作区"的账号（存量账号、被移出所有工作区的账号）会落入默认租户，并可读该租户全部非 private KB；同时每个新建 KB 默认对全工作区可读。
- 建议：最后一级改为拒绝（返回 403 或惰性创建个人工作区）；`createKb` 显式写入 `"private"`，分享时再放宽。

### P1-5 `KnowledgeBase.owner` 关系无 `onDelete`

- 证据：`prisma/schema.prisma:179`（`owner User @relation("OwnedKBs", fields:[ownerId], ...)`，无 `onDelete`），同文件其他关系均为 `Cascade`。
- 影响：删用户时 Prisma 默认 `Restrict`，管理员删号会因存在 KB 而失败；若删除路径先手动清 KB，则存在时序窗口。
- 建议：显式声明 `onDelete: Cascade` 或 `Restrict` 并在 `src/lib/db/persist.ts:deleteUserFromDb` 按序清理，二选一并写进测试。

### P1-6 Vue 接管页面后，安全响应头实际已不覆盖真实页面

- 证据：`next.config.ts:15-53` 为 `/(.*)` 配置 CSP / HSTS / `X-Frame-Options: DENY` / `nosniff` / `Permissions-Policy`；但页面层已于 V6 退役，`/` 与 30 个页面由 nginx（`deploy/nginx/frontend-switch.conf`）或 `vite preview` 承载。全仓 `add_header` 只有一处 `Cache-Control`（`frontend-switch.conf:8`），该文件 28 个 `location` 块**没有任何安全头**。
- 影响：切流后用户访问的 HTML/JS 没有 CSP、HSTS、`X-Frame-Options`、`nosniff`。这是迁移引入的**回退**，不是新增缺陷。
- 附带问题（即使头生效也偏弱）：`script-src` 含 `'unsafe-inline' 'unsafe-eval'`（`next.config.ts:40`）；`images.remotePatterns` 允许 `hostname: "**"`（`:56`，图片优化器可成为任意外链的开放代理）。
- 建议：nginx 侧补齐同一套头（CSP 至少收紧到 `'self'` 白名单并去掉 `unsafe-eval`）；`images` 白名单收紧到实际域名，若 `next/image` 已无调用则整段删除。

### P1-7 租户隔离只在路由层，DB 层无任何兜底

- 证据：`src/lib/db/hydrate.ts:60-88` 用 `findMany({})` 把**全部租户**的 users / KB / documents / AgentTask 载入进程级全局 store，无 `workspaceId` 过滤；所有查询随后在内存里做，Prisma 侧没有 RLS、也没有统一的 tenant 拦截器。
- 影响：隔离强度 = 每个路由是否记得加 `workspaceId` 过滤。漏一处就是全量泄露，且这类漏洞不会有任何数据库层报错兜住（P1-3 即是实例）。
- 建议：短期在 `src/lib/db` 之上加统一数据访问层（租户表查询强制传 `workspaceId`，缺失即抛）；中期评估 Postgres RLS（连接级 `SET app.workspace_id`）。

## 3. 应修（P2）

| 编号 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P2-1 | `/internal/testing/reset` 无环境门控 | `services/ai/app/main.py:509-513`，仅靠同一内部令牌保护 | 生产环境令牌一旦泄露即可清空内存索引；应与 `NODE_ENV`/`APP_ENV` 绑定 |
| P2-2 | `services/business` 完整实现但零 CI | 31 个 main + 7 个 test `.java`；`ci.yml` 九 job 中 grep `mvn\|java\|business` = 0；`services/business/Dockerfile:9` 用 `-DskipTests` | 200KB 代码长期无门禁会静默腐坏；默认生产链路未引用（仅 `docker-compose.split.yml` / `k8s/split.yaml` 的 PLACEHOLDER 镜像） |
| P2-3 | `services/ai` 构建不可复现 | `pyproject.toml:6-20` 全为 `>=` 下限、无 lockfile/hash；`Dockerfile:2` 基础镜像未固定 digest | 每次构建拉到不同的传递依赖 |
| P2-4 | 全局 `role` 与工作区角色两套模型并存 | `src/lib/auth/store.ts:227`（注册即 `editor`）；`/api/admin/*` 按全局角色放行；工作区管理靠 `ownerId === u.id` | 语义易混：将来若把工作区 owner 映射到全局 owner，会直接提权到管理端；也是 P1-3 的根因 |
| P2-5 | 双认证栈并存 | 自签 `kai-token`（主）+ Auth.js beta（`[...nextauth]` / oauth bridge，`package.json:37` `5.0.0-beta.32`） | 两套会话/吊销语义，审计与登出边界容易漏 |
| P2-6 | SSRF 存在 DNS rebinding TOCTOU 与 IPv6 覆盖缺口 | `src/lib/security/ssrf.ts:117-130`（先解析再按主机名发起请求，未 pin IP）；`isPrivateIpv6` 未覆盖 NAT64 `64:ff9b::/96` | 攻击者控制的域名可在校验后改解析到内网 |
| P2-7 | SW 旧版本 cache 永不清理 | `public/sw.js:36`（`VERSION = "v6-vue-1"`）vs `:127`（清理 filter 写死 `startsWith("p5-1-")`） | 版本一号一步，`v6-vue-1-shell/-runtime` 即成永久孤儿，缓存无界增长 |
| P2-8 | SW 把鉴权页面 HTML 写入共享 cache | `public/sw.js:161`（navigate 成功即 `cachePut`）、`:136-142`（无路径过滤） | 读取侧有白名单（`:166`）不会展示给他人，但登出后页面快照仍留在磁盘 |
| P2-9 | 依赖供应链 | `package.json:47`（`xlsx` 取自 `cdn.sheetjs.com` tarball，不参与 `pnpm audit` 与 lockfile 完整性校验）；`ci.yml` 仅 `--audit-level=critical` | high 级漏洞不阻断 |
| P2-10 | Lint 无类型感知规则 | `eslint.config.mjs` 未启用 `projectService`，无 `no-floating-promises` | P1-1 那类 fire-and-forget 不会被静态拦住 |
| P2-11 | `sdk/go` 有测试但 CI 不跑 | `sdk/go/kai_test.go` 存在；`grep "go test" .github/workflows/` = 0 | 手写 SDK 与 API 契约随时漂移 |
| P2-12 | 前端视图过大且无分包 | `SettingsView.vue` / `KbDetailView.vue` / `AdminView.vue` / `HomeView.vue` 均 ≥1000 行；`frontend/vite.config.ts:93-95` 无 `manualChunks`、无 `sourcemap` | 编排逻辑堆在视图层，重复样板多；主 chunk 不可控 |
| P2-13 | 前端 401 跳转丢回跳地址 | `frontend/src/api/client.ts:53-56`（`window.location.href = "/login"`） | 会话过期后用户丢失当前页面上下文 |
| P2-14 | 验证/验收脚本整体关掉类型检查 | 全仓 50+ 处 `@ts-nocheck`，其中 `scripts/smoke/*.ts` 约 45 个；`eslint.config.mjs:55-63` 对 `scripts/**` 关闭 `no-explicit-any` | 发布前最后一道门本身不受类型与严格 lint 约束 |

## 4. 对第一版判断的修正（含降级与撤回）

| 第一版说法 | 本次核实 | 处理 |
| --- | --- | --- |
| P2-11「`/api/team` 成员列表无租户维度」 | 证据成立且影响是**跨工作区 PII 读取**，非"仅多租户部署下"的边角 | **升级为 P1-3** |
| 「前端无 CSRF 机制」（子代理初步推断） | 会话 cookie 全站 `httpOnly + sameSite: "lax"`（`src/app/api/auth/*/route.ts:91,101,140,163` 等 6 处）；全仓 64 个 GET handler 中抽出 7 个含写操作关键词的逐一核对，实际写状态均在 POST/PATCH/DELETE 分支 | **降级为可接受**：保留"无纵深防御"记录，不列入 P1/P2 |
| 「覆盖率门槛 70/60，实际 64/61/66/52」 | 目录门槛值属实（`vitest.config.ts:77`）；但实测 lines 68.47% 已高于全局 floor 64，ratchet 在工作 | 定性改为"分目录低位仍在（`db 33` / `storage 20` / `queue 45`），全局已不贴地板" |
| 「project 记录称 CI 7 job」 | 实测 9 个（quality / unit / frontend / ai-contract / integration / smoke / smoke-infra / e2e / docs），与 `AGENTS.md` 一致 | 该条目无漂移，仅 `ci.yml:128` 注释仍写 "70%/60%" 未同步 `vitest.config.ts` |
| 「17 个迁移」 | 实测 25 个 | 与第一版一致，确认漂移存在于历史交接记录中 |
| 「`sdk/python/__pycache__` 是仓库卫生问题」 | `git ls-files "*.pyc"` = 0，为本地未跟踪残留 | **撤回** |

## 5. 值得保留的做法（不要回退）

1. 路由守卫覆盖到位：`src/app/api` 下无 Prisma 直连，业务路由统一走 `getRequestUser` / `requireRole`；公开路由（health / openapi / share / files）均有各自的归属校验。
2. `src/lib/security/ssrf.ts` 的生产 fail-closed：仅 `NODE_ENV=development|test` + 显式 opt-in 才放行内网。
3. `/api/files/[key]` 的 IDOR 修复：key 按 `<userId>__` 命名空间 + 404 不确认存在 + `Content-Disposition: attachment`。
4. API Key 只存 `sha256$` 哈希 + `timingSafeEqual`（`src/lib/apikeys/store.ts:117-139`）。
5. 前端 4 处 `v-html` **全部**经 `markdown-it`（`html: false`），且有单测反证 `<img onerror>` 被转义；`@shared` 单源约束实际遵守（67+ 处引用，无拷贝）。
6. CI 的工程细节：迁移漂移 + 空库重放 + 真实 PG 语义测试 + 生产构建延迟门禁 + 覆盖率 ratchet（只升不降）。
7. 队列背压与探针降级可观测（`QueueBackpressureError`、`queueBackpressured`、`revocationDegraded`）。
8. 技术债标记极少：全仓（排除 `node_modules`）`TODO|FIXME|HACK` 命中 0。

## 6. 建议修复顺序（约半天到一天）

1. `/api/team` 成员列表加租户过滤（P1-3）——唯一"已存在的"横向 PII 读取。
2. nginx 侧补齐安全响应头，收紧 CSP 与 `images` 白名单（P1-6）——改动只在配置。
3. 一个 migration 补齐 P1-2 索引（最低成本、最高收益）。
4. `resolveWorkspace` 最后一级改为拒绝 + `createKb` 显式 `private`（P1-4），配套负例测试。
5. 认证写路径 `await` 化（P1-1），先做 `auth/store.ts` 与 `password-reset.ts`。
6. `KnowledgeBase.owner` 的 `onDelete` 明确化（P1-5）。
7. `services/ai` 的 `testing/reset` 环境门控（P2-1）；SW 缓存清理前缀与鉴权页面过滤（P2-7/P2-8）。
8. 排期项：`db`/`storage` 覆盖率抬升、租户数据访问层 / RLS（P1-7）、`services/business` 接入 CI（P2-2）、双认证栈收敛（P2-5）、SSRF IP pin（P2-6）。

## 7. 本次未验证（不要当作已通过）

- 未跑 `pnpm build`、`test:integration`、`e2e`、`smoke`、`smoke-infra`、`ai-contract`：`services/ai` 与 `services/business` 的结论全部来自静态阅读与子代理核查，未经运行验证。
- 未做运行时探测（接口、SSE、限流档位、切流后的实际响应头）。
- 未做负载与容量验证：P1-2 的性能影响为结构性推断，需 `EXPLAIN` 或压测确认。
- 未审查 `services/business` 的 Java 业务逻辑正确性，仅确认其规模、调用方与 CI 状态。
- 本机 Node 为 v24.20.0，CI 为 node 22；本次门禁在该版本组合下通过，未在 22 上复跑。

## 8. P1 处理结果（PR #111）

| P1 | 状态 | 落地 |
| --- | --- | --- |
| P1-1 写穿 fire-and-forget | 已修：登录/注册/OAuth/改密/角色/封禁/重置与验证令牌/工作区成员全部 `await` 落盘后返回 | `src/lib/auth/{store,password-reset,email-verify}.ts`、`src/lib/workspace/store.ts`、`src/lib/team/store.ts` |
| P1-2 高频表缺索引 | 已修：4 个索引 + `KnowledgeBase.owner` 级联 | `prisma/migrations/20261119120000_tenant_indexes_owner_cascade` |
| P1-3 `/api/team` 跨租户成员列表 | 已修：`listMembers(workspaceId?)` 按 `Workspace.members` 裁剪，4 处调用点传租户 | `src/lib/team/store.ts`、`src/app/api/team/*`、`usage`、评论 @mention |
| P1-4 租户兜底 + 新 KB 默认 view | 兜底已修（`resolveWorkspace` 返回 `null`，配套 `getRequestIdentity` 保住邀请/建工作区通道）；**新 KB 默认 private 未采纳** | `src/lib/workspace/store.ts`、`src/lib/auth/guard.ts` |
| P1-5 `KnowledgeBase.owner` 无 onDelete | 已修（`Cascade`） | `prisma/schema.prisma` |
| P1-6 页面无安全响应头 | 已修：网关 server 级 + `/assets/` 重复 + vite preview 同口径 | `deploy/nginx.conf`、`scripts/deploy/switch-frontend.sh`、`frontend/vite.config.ts` |
| P1-7 租户统一数据访问层 / RLS | **未做**（架构级，需单独排期） | — |
| 覆盖率注释漂移（P1-6 附带） | 已修：注释与 PR 模板指向 `vitest.config.ts` | `.github/workflows/ci.yml`、`.github/PULL_REQUEST_TEMPLATE.md` |

**P1-4 后半段未采纳的理由**：`frontend/e2e/collab.spec.ts` 显式依赖「owner 新建的 KB 对工作区成员可读」，同租户内默认共享是既有产品语义；改成 private 会静默改变协作行为，需产品决策。跨租户读取通道已由 `resolveWorkspace` 失败关闭消除。

**P1-1 的边界**：`withFkRetry` 仍只对 P2003 重试、其余错误落日志后返回 `undefined`——本次只把调用侧从 fire-and-forget 改为 `await`，让调用方能感知"写入未完成"的时序，但 `persist.ts` 内部的错误吞掉语义未变（没有新增失败可见性指标），P1-1 的"加有界重试 + 失败计数 + `persistDegraded` 探针"仍是后续项。

**验证（本机，Node 24.20.0）**：`npx tsc --noEmit` 0 错误；`pnpm lint` 通过；`pnpm test:unit` 121 文件 / 1032 用例通过，lines 68.6%（floor 64）；`pnpm -C frontend typecheck|lint|vitest` 通过（12 文件 / 45 用例）。
**未在本机验证**：`prisma migrate dev`（无 Postgres）、`nginx -t`（无 nginx 二进制）、`build` / `integration` / `e2e` / `smoke` —— 全部交由 PR CI 判定。
