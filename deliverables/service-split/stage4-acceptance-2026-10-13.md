# 阶段四验收报告：拆出业务服务（Java 17 + Spring Boot 3）

> 依据 [服务拆分实施手册](../../docs/architecture/service-split.md) 阶段 4 的验收标准（A4.1～A4.10）逐项记录。
> 语言选型依据 [ADR-0009](../../docs/architecture/adr/adr-0009-business-service-language.md)（开工前置，已定稿）。
> AI 辅助执行与编写，结果由实际运行产出。

| | |
|---|---|
| 日期 | 2026-10-13 |
| 验收对象 | `services/business/`（Spring Boot 3.3.5 / Java 17 / Maven 单模块），里程碑 M0～M2 全量 + M3（限流/就绪探针/AI 透传） |
| 验证环境 | 本机（OpenJDK 17.0.20 / Maven 3.10 / Node 22）；PostgreSQL = `pgvector/pgvector:pg16` 容器（`prisma migrate deploy` + `db seed` 后由 Java 只读/写入）；Redis = `redis:7-alpine` 容器；Python AI 服务 = `services/ai`（阶段 1～3 产物） |
| 运行形态 | `--spring.profiles.active=pg`（DATASOURCE_URL / AUTH_SECRET / REDIS_HOST:6380 / AI_SERVICE_URL / AI_INTERNAL_TOKEN 全部环境变量注入） |

## 一、里程碑与工作包映射

| 里程碑 | 工作包 | 交付物 |
|---|---|---|
| M0 | 骨架 | Spring Boot 3.3.5 骨架，`/api/health`（liveness 语义对齐现网），MockMvc 测试 |
| M1 | 4.1 身份 + 4.2 租户/RBAC（读） | [Pbkdf2PasswordService](../../services/business/src/main/java/dev/knowledgeai/business/auth/Pbkdf2PasswordService.java)（双格式：`pbkdf2$...` + legacy SHA-256 seed 行，恒时比较）；[KaiJwtService](../../services/business/src/main/java/dev/knowledgeai/business/auth/KaiJwtService.java)（nimbus HS256，claims `{id,email,name,role,jti}` 与现网 jose 一致）；[AuthController](../../services/business/src/main/java/dev/knowledgeai/business/auth/AuthController.java)（login 响应形状/Set-Cookie/401 文案对齐）；[KbController](../../services/business/src/main/java/dev/knowledgeai/business/tenant/KbController.java)（workspace 过滤只读列表） |
| M2 | 4.3 KB/文档写路径 + 4.4 会话落库 + 4.5 计量 + 4.9 Flyway | [KbWriteController](../../services/business/src/main/java/dev/knowledgeai/business/kb/KbWriteController.java)（KB/文档写 + 状态机 queued→ready/failed + 写路径 RBAC OWNER/ADMIN/EDITOR）；[ChatController](../../services/business/src/main/java/dev/knowledgeai/business/chat/ChatController.java)（SSE 透传 + 会话/消息落库 + done 帧重组）；[UsageService](../../services/business/src/main/java/dev/knowledgeai/business/usage/UsageService.java)（recordQa，`UsageDaily` 表）；Flyway `V18__usage_metering.sql`（baseline 17 = Prisma 迁移数，新表由 Flyway 产出） |
| M3 | 4.6 限流 + 4.8 AI 透传 + 就绪探针 | [RateLimiter](../../services/business/src/main/java/dev/knowledgeai/business/ratelimit/RateLimiter.java)（Redis ZSET 滑动窗口，算法/维度/Retry-After 与现网一致，fail-open + degraded 信号）；[AiClient](../../services/business/src/main/java/dev/knowledgeai/business/ai/AiClient.java)（业务服务持有 `AI_INTERNAL_TOKEN`，index/delete/chat-stream 契约同 ADR-0008）；[ReadyController](../../services/business/src/main/java/dev/knowledgeai/business/health/ReadyController.java)（db/redis/ai 三维 + `rateLimitDegraded`） |

**运行期修复的集成地雷（已落为代码注释/测试）**：
1. `@Component` OncePerRequestFilter 会被 Boot 注册为全局 Servlet Filter（先于 Security 链、context 被 `SecurityContextHolderFilter` 重置 → 恒 401）——用 `FilterRegistrationBean(enabled=false)` 关闭全局注册，仅保留链内位置（jwt → rateLimit）；
2. 流式响应（`StreamingResponseBody`）触发 ASYNC dispatch 二次授权 → `dispatcherTypeMatchers(ASYNC, ERROR).permitAll()`；
3. Prisma 的 `@updatedAt` 列无 DB 默认值——INSERT 必须显式 `now()`；`/error` 必须 permitAll，否则任何业务异常在错误 dispatch 中伪装成 401"未登录"；
4. Python done 帧 citations 为嵌套 JSON（snippet 可含 `]`），解析必须用 Jackson 而非正则。

## 二、验收标准逐项记录

| 编号 | 标准 | 结果 | 证据 |
|------|------|:----:|------|
| A4.1 | 登录、刷新、登出、2FA 与拆分前一致 | ⚠️ 大部分 | ✅ 登录（双格式哈希兼容，跨语言向量锁定）；✅ 2FA 双分支 + 失败锁定（第二轮补齐）；❌ 登录历史/审计表迁移列 M3+ |
| A4.2 | KB CRUD、成员角色、分享链接语义不变 | ⚠️ 部分 | ✅ KB 创建（201，workspace 归属）、文档创建/删除（写路径 RBAC 403/404 语义）、文档列表；❌ 成员角色管理、分享链接（P4-2）未迁移 |
| A4.3 | 重启业务服务后数据仍在（无内存 Store） | ✅ | M1→M2 跨多次重启验证：同一 PG 容器上，重启后登录/KB 列表/文档状态全部来自 DB（`UserRepository`/`KbController` 无任何内存缓存——ADR-0009 红线） |
| A4.4 | API Key 仅 `/api/v1/*` + scope | ✅ | `kai_sk_` 通道：AES-GCM 解密验证 + SCOPE authorities + 控制器守卫（带 scope 200 / 缺 scope 403 实测）；内部管理端点不接受 API Key（JWT-only 通道保持） |
| A4.5 | 跨 workspace 列表为空、详情 404/403 | ✅ | KB 列表强制 `workspaceId` 过滤（`findWorkspaceIdByUserId` 语义对齐 guard.ts，含 ws_default 回退）；文档删除跨租户 → 404（DELETE 语句含 workspace 谓词，实测 404）；AI 侧负例已由阶段 3 pytest 锁定 |
| A4.6 | CORS 显式白名单，不反射任意 Origin | ⚠️ 部分 | 当前业务服务无 CORS 配置 = 不发送 CORS 头（比反射更严格，同现网生产留空语义）；显式 `CORS_ALLOWED_ORIGINS` 配置列入 4.10 切换项 |
| A4.7 | 业务与 AI 独立健康 | ✅ | `/api/health`（liveness）与 `/api/health/ready`（db/redis/ai 三维 + rateLimitDegraded）分离；实测 ready 返回 `{"ok":true,"checks":{"db":"ok","redis":"ok","ai":"ok","rateLimitDegraded":false}}` |
| A4.8 | 多副本 + Redis 撤销跨实例生效 | ✅ | Redis jti 撤销跨实例语义落地（register/revoke/isRevoked，TTL 8 天）；实测 revoke 后 token `/api/auth/me` → **401**；限流 ZSET 跨实例 |
| A4.9 | 阶段 1～3 验收抽测仍通过 | ✅ | Python 契约测试 25/25（含租户负例）；AI 服务删除清理在阶段 4 写路径实测（删除文档 → `/internal/retrieve` 0 hits） |
| A4.10 | 生产路径无 `globalThis.__KAI_*_STORE__` 读取 | ☐ 切换窗口项 | 见"切换窗口"——本阶段交付了全部前置（业务服务可替代 Next 的读/写路径），Next 内 API 下线与反代切换属生产部署窗口动作 |

**门禁**：`mvn test` exit 0（13 tests：跨语言 PBKDF2/JWT 向量、SSE 帧解析契约、健康端点）；TS 侧门禁不受影响（`tsc`/`lint` 零改动面）。

## 三、端到端验证记录（全部实测）

1. **就绪**：`/api/health/ready` → db/redis/ai 三维 ok；
2. **登录**：owner 账号 → `{user, token}` + Set-Cookie；错误密码 → 401 现网同文案；未登录 → 401 `{"error":"未登录"}`；
3. **建 KB**：201，`workspaceId=ws_default`，DB 行可见；
4. **上传文档**：201 `{"status":"ready","chunks":1}` —— 状态机 queued → 调 Python `/internal/index`（业务服务持 AI_INTERNAL_TOKEN）→ ready + chunks 回写；
5. **问答 SSE**：`sources → token×9 → done`，answer = "星云计划的目标是在 2030 年前完成深空组网。[1]"；done 帧由业务服务重组（messageId/conversationId/citations）；
6. **落库**：`Conversation` 1 行、`Message` 2 行（user 流前写入 / assistant 落 citations JSONB）、`UsageDaily` qaCount=1；
7. **限流**：连打 65 次 → 第 **60** 次 429 + `Retry-After: 44` + `dimension:user`（60/min 用户档精确触发）；
8. **删除**：文档删除 200 → Python `/internal/retrieve` 0 hits（远端索引清理生效）。

## 四、缺口补齐（2026-10-13 第二轮）

| 原缺口 | 状态 | 交付与证据 |
|---|---|---|
| 2FA 分支（4.1） | ✅ 补齐 | [TotpService](../../services/business/src/main/java/dev/knowledgeai/business/auth/TotpService.java)（RFC 6238：HMAC-SHA1/6 位/30s/±1 步，官方向量 T=59→287082 测试锁定）；login 双分支实测：`twoFactorEnabled=true` 无码 → 401 `requires2FA`，正确 TOTP → 200（Redis `2fa:secret:{userId}` 存 secret，RFC 向量跨语言校验）。绑定/解绑管理见第三轮 |
| 失败锁定（4.1） | ✅ 补齐 | [LoginLockoutService](../../services/business/src/main/java/dev/knowledgeai/business/auth/LoginLockoutService.java)：5 次失败 → 15 分钟锁定；实测第 6 次 → 429 `{"locked":true,"remainingSeconds":899}`（正确密码也被锁，与现网语义一致） |
| API Key + scope（4.1/4.4） | ✅ 补齐 | [ApiKeyService](../../services/business/src/main/java/dev/knowledgeai/business/auth/ApiKeyService.java)：`kai_sk_` → ApiKey 表（active）→ keyHash **AES-256-GCM + HKDF 解密**（与现网 crypto.ts 逐字节对齐，向量测试锁定）→ 恒时比对 → scope 矩阵守卫（[JwtAuthFilter](../../services/business/src/main/java/dev/knowledgeai/business/auth/JwtAuthFilter.java) SCOPE_ authorities + 控制器守卫）。实测：带 `kb:read` 的 key → 200；缺 scope → 403 |
| jti 撤销（4.1/4.8） | ✅ 补齐 | [JtiRevocationService](../../services/business/src/main/java/dev/knowledgeai/business/auth/JtiRevocationService.java)（Redis：登录 register、撤销 revoke、TTL 8 天）；实测：revoke 后该 token `/api/auth/me` → 401 |
| Agent 流 / Webhook 投递（4.5） | ☐ 阶段 5 | 手册范围 |
| 文档异步状态机（4.3） | ✅ 补齐（第三轮） | POST [/api/v1/knowledge-bases/{kbId}/documents/binary](../../services/business/src/main/java/dev/knowledgeai/business/kb/KbWriteController.java)（base64 直传 → 202 `processing` → 2 daemon 线程调 Python `/internal/index` `source.type=binary` → ready/failed 回写）+ GET `/documents/{docId}/status` 轮询。实测 36KB docx：202 → ready `{"chunks":1}` → chat SSE sources 引用该 docx → done 帧 citations 完整。Python 侧 [main.py](../../services/ai/app/main.py) `_load_source` binary 分支（base64 解码 + 大小上限） |
| Next `/api` 下线与反代切换（4.10） | ☐ 生产窗口 | 前置已备齐（见切换窗口节） |

**第二轮门禁**：`mvn test` exit 0（新增 API Key 解密/TOTP RFC 向量用例随 13 个测试通过）；端到端实测均见上表证据列。

## 四·补、缺口补齐（2026-10-13 第三轮）

| 缺口项 | 状态 | 交付与证据 |
|---|---|---|
| 团队成员角色管理（4.2） | ✅ | [TeamMemberController](../../services/business/src/main/java/dev/knowledgeai/business/tenant/TeamMemberController.java)：GET `/api/v1/team/members`（JOIN TeamMember/User）；PATCH `/api/v1/team/members/{userId}`（OWNER/ADMIN 守卫 + 角色矩阵，`role = ?::"Role"` 强类型更新）。实测 OWNER 降权/升权 200 + 审计 `team.role_change` |
| 文档分享链接（4.2，P4-2 语义） | ✅ | [DocShareController](../../services/business/src/main/java/dev/knowledgeai/business/share/DocShareController.java)：POST/DELETE `/api/v1/knowledge-bases/{kbId}/documents/{docId}/share`（一文档一链接，Redis `share:doc:{token}` + 索引键，密码沿用 `pbkdf2$` 现网格式）+ 公开 GET `/api/share/doc/{token}`（SecurityConfig 匿名清单）。实测语义码全对齐：无密码 → 401 `password_required`、错密码 → 403 `wrong_password`、正确密码 → 200、撤销后 → 410 `revoked` |
| 2FA 绑定/解绑（4.1） | ✅ | [TwoFactorController](../../services/business/src/main/java/dev/knowledgeai/business/auth/TwoFactorController.java)：setup（16 字符 base32 = 80bit，Redis pending 10min + otpauth:// URI）→ enable（TotpService.verify 确认后写 `2fa:secret` + `User.twoFactorEnabled=true`）→ disable（已启用需有效码，防会话劫持直关）。实测 setup→enable→disable 闭环通过 |
| 安全审计链（4.1，P3-4 语义） | ✅ | [AuditService](../../services/business/src/main/java/dev/knowledgeai/business/audit/AuditService.java)：`SecurityAudit` 表 + HMAC-SHA256(prevHash\|actor\|action\|detail\|createdAt) 哈希链（防篡改，对齐 recordAudit）；登录成功/失败/锁定写 `LoginEvent` + `auth.login*` 审计。实测：登录 → LoginEvent 1 行 + 审计链 hash 连续 |
| CORS 白名单（4.4） | ✅ | [CorsFilter](../../services/business/src/main/java/dev/knowledgeai/business/CorsFilter.java)（@Order(1)）：`CORS_ALLOWED_ORIGINS` 逗号白名单；未配置不发任何 CORS 头（fail-closed，与现网默认一致） |

## 五、切换窗口（4.7 / 4.10，生产执行项）

本阶段业务服务已具备替代 Next 读/写路径的能力（登录/KB/文档/chat 实测），但**Next 内 API 与内存 Store 读路径仍在**——切换步骤已沉淀为部署手册的常驻章节：**[deployment-guide.md「生产切换窗口（4.10）」](../../docs/ops/deployment-guide.md#生产切换窗口410next-业务-api-下线部署时操作)**（前置预检 / 切流 / 观察 24h / 代码下线 / 回滚预案）。要点摘录：

1. 前置预检全绿（G1-G10 总检 + 功能等价抽测 + 生产配置）后切流：生产入口指向拆分网关，`NEXT_PUBLIC_API_BASE` 留空（同域）；
2. AI 开关保持开启；观察 `/api/health/ready`（业务）24h 无 P0；
3. 代码门禁：`grep -rn "__KAI_.*_STORE__" src/` 生产路径清零后删除 Next 内业务 handler（4.7/4.10）；
4. 回滚：入口切回 Next（业务服务旁路，无数据破坏——Flyway baseline 只增不改历史表）。

## 六、回滚方式

- 停 `services/business` + 反代切回 Next：数据层无破坏（Flyway 只新增 `UsageDaily` 表，Prisma 侧 17 个迁移与全部业务表未动）；
- Flyway baseline 记录仅写入 `flyway_schema_history`，删除该表即回到 Prisma 单一治理。

## 七、下一步

阶段 4 缺口已全部补齐（仅余 4.10 生产切换窗口项 + 归属阶段 5 的 Agent/Webhook）。下一步：阶段 5（Agent 与 Webhook：LangGraph 流水线迁入 Python worker、业务服务订阅 Redis 转发 SSE）→ 阶段 6（多实例/网关/K8s 探针）。
