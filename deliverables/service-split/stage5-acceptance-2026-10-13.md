# 阶段五验收：Agent 与 Webhook（2026-10-13）

对应 [service-split.md 阶段 5](../../docs/architecture/service-split.md)（5.1-5.6），语言与框架边界见 [ADR-0008](../../docs/architecture/adr/adr-0008-ai-service-framework.md)（1.1.0 修订）与 [ADR-0009](../../docs/architecture/adr/adr-0009-business-service-language.md)。承接阶段四验收（`stage4-acceptance-2026-10-13.md`）。

## 一、交付物

### Python AI 服务（`services/ai/`）

| 模块 | 说明 |
|---|---|
| [app/agent.py](../../services/ai/app/agent.py) | **LangGraph 四角色流水线**（ADR-0008 边界：`langgraph` 依赖仅此模块 import）：planner → searcher → analyzer → writer；4 套模板（default/competitive/tech-selection/market）的 sections/parallelSearch/conditionalExpand 与 TS `templates.ts` 一致；检索复用 `hybrid_search`（workspace_id + kb_id 双过滤，租户契约）；分析器 embed 余弦挑句（对齐 TS analyzer）；报告合成 `compose_report`（report/ppt/mindmap 三格式逐段移植）；LLM 可用时走报告生成（失败回退合成，与 TS 一致）；done 快照为 camelCase AgentTask JSON（含 dagNodes/dagEdges，业务服务直接透传） |
| [app/agentqueue.py](../../services/ai/app/agentqueue.py) | 队列 + worker：Redis List `agent:queue`（LPUSH/BLPOP，语言中立）；进程内 asyncio worker（uvicorn lifespan 启动）；心跳 `agent:worker:heartbeat`（TTL 30s/10s 续期）；进度发布 channel `agent:<taskId>`（与 TS agent-bus-redis.ts 同名），帧 `step/done/error/end`（init 由业务服务发送）；终态快照 `agent:final:{taskId}`（TTL 7 天，业务服务懒回收兜底） |
| [app/external.py](../../services/ai/app/external.py) | 外源搜索：Tavily/SerpAPI/Brave（env 门控，与 TS 同名 env）+ ArXiv 公开 API + GitHub；全空时演示回退（确定性合成，对齐 TS demoWebResults）；URL 去重/质量分同形。**SSRF 闸门 `assert_public_url` 恒定 fail-closed**（无环境旁路——比 KB 源抓取的 `_assert_public_http` 更严格，外源结果 URL 来自第三方 API 不可信） |
| [main.py](../../services/ai/app/main.py) | `POST /internal/agent/run`：校验载荷 → `QUEUE_MAX_DEPTH` 深度检查（超限 429 `queue_busy`）→ LPUSH 入队 → 202。lifespan 启动/停止 worker |
| pyproject.toml | 新增 `redis>=5`、`langgraph>=0.2,<0.7`（锁定） |

### Java 业务服务（`services/business/`）

| 模块 | 说明 |
|---|---|
| [agent/AgentController.java](../../services/business/src/main/java/dev/knowledgeai/business/agent/AgentController.java) | 5.1 任务 API：`POST /api/v1/agent/run`（鉴权 JWT / API Key `agent:run` → KB 归属校验 → 写 `AgentTask` 行 → 心跳检查 → 经 Python `/internal/agent/run` 入队）→ **SSE 订阅 `agent:<taskId>` 转发**（订阅先于入队防丢首帧；25s 保活注释帧；硬超时关流）。事件契约与现网一致：`init/step/done/error/end`（`data: {json}` 帧，done.task 为完整任务快照）。另含：`GET /api/agent/tasks`（列表，userId+workspaceId 双过滤）、`GET /api/agent/tasks/{id}`、`POST /api/agent/tasks/{id}/retry`（仅 failed 可重试）、`PUT /api/agent/tasks/{id}/share`（P2-3 分享语义，SHA-256 密码哈希）、`GET /api/share/report/{id}`（5.4 公开报告） |
| 懒回收（sweepTasks） | 列表/详情读取前执行：① `agent:final:{taskId}` 终态快照回填（流中断/无订阅者时取回真实结果）；② queued/running 超过 `AGENT_TASK_TIMEOUT_SECONDS`（默认 900s）→ 标记 failed（A5.6 worker 中途挂掉语义） |
| [agent/AgentEventBus.java](../../services/business/src/main/java/dev/knowledgeai/business/agent/AgentEventBus.java) | `RedisMessageListenerContainer` 封装：subscribe → FrameChannel（SSE 线程 poll / close 退订） |
| [agent/WebhookService.java](../../services/business/src/main/java/dev/knowledgeai/business/agent/WebhookService.java) | 5.5 投递：三事件 `kb.ready` / `agent.completed` / `usage.alert`（事件名与 data 形态逐字段对齐 TS handlers.ts/kb/store.ts/billing/store.ts）；签名 `X-KAI-Signature: sha256=HMAC-SHA256(secret, body)` 小写 hex——**RFC 2104 手工构造**（JCE SecretKeySpec 拒绝空密钥而 WebCrypto 允许，为字节级兼容统一走本实现）；头 `X-KAI-Event/X-KAI-Signature/X-KAI-Delivery/User-Agent: KnowledgeAI-Webhook/1.0`；3 次尝试（2s/4s 退避）+ failures/lastError 回写；投递记录进程内环形 100 条（对齐 TS store.ts）；**投递前 SSRF 复检**（`targetAllowed`，本地接收器经 `SSRF_ALLOW_PRIVATE_HOSTS=true` 放行，与仓库 smoke 套件同名环境策略） |
| 挂点 | kb.ready：[KbWriteController](../../services/business/src/main/java/dev/knowledgeai/business/kb/KbWriteController.java) 同步/异步索引成功路径；agent.completed：AgentController done 帧（`{taskId, topic, kbId, kbName, status, outputFormat, durationMs}`）；usage.alert：[UsageService](../../services/business/src/main/java/dev/knowledgeai/business/usage/UsageService.java) recordQa 后阈值判定（env `USAGE_ALERT_QA_LIMIT` 覆盖，否则按 plan：free 100/其余不限量——对齐现网 plans.ts；Redis 每日去重） |
| [health/ReadyController.java](../../services/business/src/main/java/dev/knowledgeai/business/health/ReadyController.java) | 就绪探针新增 `agentQueueDepth`（LLEN `agent:queue`）+ `agentWorker`（heartbeat 存在性）——A5.7 背压暴露（仅观测，不参与 degraded） |
| [auth/ApiKeyService.java](../../services/business/src/main/java/dev/knowledgeai/business/auth/ApiKeyService.java) | **修复 hasScope 花括号缺陷**：PG `text[]::text` 渲染 `{a,b}`，原实现只剥 `[]` 导致任何 scope 恒不匹配（阶段 4 遗留，本阶段 SDK 验收暴露） |
| [ai/AiClient.java](../../services/business/src/main/java/dev/knowledgeai/business/ai/AiClient.java) | 新增通用 `postInternal(path, json)`；`toJson` 支持字符串列表（agents 载荷） |

### 测试

- Python：[tests/test_agent.py](../../services/ai/tests/test_agent.py)（18 用例）：SSRF 负例 9 组（含 `169.254.169.254` 元数据 IP、回环、私网段、`.internal`、`file://`）+ 公网放行 + 无环境旁路；流水线 done/step 序（planner/searcher/analyzer，writer 无独立 step——与 TS 一致）/三格式报告/模板/并行标记；外源演示回退形态；签名兼容向量。全套 `pytest tests -q` **43 passed**（含阶段 1 契约回归）。
- Java：[WebhookSignTest](../../services/business/src/test/java/dev/knowledgeai/business/agent/WebhookSignTest.java)（签名格式/空密钥/已知向量互验 + SSRF 负例 8 组）。`mvn test` **16 passed**。

## 二、验收标准（A5.1-A5.7）

| 编号 | 标准 | 结果 | 证据 |
|---|---|---|---|
| A5.1 | Agent 主路径产出 Markdown 报告，SSE 事件名不变 | ✅ | `POST /api/v1/agent/run`（JWT）→ `init → step×3 → done → end`；done.task 携带完整报告 + 引用；带 KB 运行 `共检索到 5 条引用来源（内部 2 + 外部 3）`，报告引用 KB 文档；任务落库（列表/详情回读 status=done、steps=3、durationMs≈3775） |
| A5.2 | SDK `agent.run` 仍可用 | ✅ | 官方 JS SDK（[kai-sdk.mjs](../../sdk/javascript/kai-sdk.mjs)）`runAgent` 直连业务服务 :8080：`status: done`、steps `planner,searcher,analyzer`、citations 3（与 `test-sdk.ts` 同断言口径；API Key scope `agent:run` 守卫生效——scope 缺失时 403） |
| A5.3 | 未启用分享的报告匿名 403 | ✅ | 缺省 → 403 `{"code":"disabled"}`；PUT share 启用后：无密码 401 / 错密码 401（`x-share-password` 头，不进 URL）/ 正确密码 200（topic/report/citations/views）/ 不存在 404 |
| A5.4 | 外源 URL SSRF 校验（fail-closed） | ✅ | Python：`assert_public_url` 对元数据 IP（169.254.169.254）/回环/私网/`.internal`/`file://` 全部拒绝（pytest 锁定，无环境旁路）；Java：`targetAllowed` 同语义 8 组负例单测锁定 |
| A5.5 | 文档索引完成后订阅方收到 `kb.ready` 且验签通过 | ✅ | 本地接收器 :5099 收到 `kb.ready`，`X-KAI-Signature` 与 `HMAC-SHA256(whsec_stage5, body)` 本地复算**逐字节一致**；data 形态 `{kbId, kbName, docId, docName, chunks, status}` 对齐现网；`agent.completed` / `usage.alert` 同链路实测送达（签名同算法） |
| A5.6 | Python worker 挂掉时任务进入失败/可重试，业务 API 仍可列出任务 | ✅ | 停 worker：心跳过期后 POST → SSE `error(worker_offline)` + 任务 failed；HTTP 拒连（心跳未过期窗口）→ `queue_failed` + failed；列表接口照常返回（含懒回收）；retry：离线 503 → worker 恢复后 retry → queued → **done 出报告**（重试闭环）；伪造超时 queued 行 → 列表读取触发懒回收 → failed |
| A5.7 | 队列深度达 `QUEUE_MAX_DEPTH` 时拒绝新 Agent 并在就绪探针暴露 | ✅ | Python 以 `QUEUE_MAX_DEPTH=1` 启动，并发 8 路 Agent：2 路被拒（SSE `error code=queue_busy`，任务 failed 可重试）、6 路完成；`GET /api/health/ready` 暴露 `agentQueueDepth` / `agentWorker` |

**退出条件 A5.1～A5.6 全部满足**；A5.7（背压）超额完成。

## 三、架构语义与偏差记录

1. **队列：arq → 语言中立 Redis List**（[ADR-0008 已修订 1.1.0](../../docs/architecture/adr/adr-0008-ai-service-framework.md)）：生产者在 Java 侧，arq 入队 wire format 为私有协议；`QUEUE_MAX_DEPTH` 背压语义不变，切换点封装在 `agentqueue.py`。
2. **worker 形态**：进程内 asyncio worker（uvicorn lifespan），满足 A5.6/A5.7；多实例部署（阶段 6）时演进为独立进程/多消费者，接口不变。
3. **usage.alert 阈值**：env `USAGE_ALERT_QA_LIMIT` 覆盖 + plan 兜底（free=100）；billing 模块完整迁移后对齐 plan 定义。
4. **Webhook 订阅管理**：投递链路本阶段交付；订阅 CRUD 仍在 Next 侧（SDK `createWebhook` 走 :3000），业务服务端 CRUD 随阶段 6 反代切换一并迁移（验收用 SQL 造数）。
5. **hasScope 缺陷修复**（阶段 4 遗留）：PG 数组 `::text` 渲染 `{...}`，原实现剥 `[...]` 导致 scope 恒不匹配；已修复并由 SDK 验收覆盖。

## 四、回滚方式

- 业务服务停用 Agent 路由（旁路）：Next 侧 `/api/agent/run` 原路径未动，反代切回即回滚；
- Python 侧 `langgraph`/`redis` 依赖仅 agent 模块引用，RAG 路径（index/retrieve/chat）零改动——回滚删 `app/{agent,agentqueue,external}.py` 与 `/internal/agent/run` 路由即可；
- 数据层：无新表（AgentTask/WebhookSubscription 均为既有表），Flyway 无新迁移。

## 五、下一步

阶段 6（前端解耦、网关与多实例：Next 业务路由下线、BFF 网关、业务/worker 多实例与 K8s 探针）；其前置 4.10（反代切换）仍为生产窗口项。
