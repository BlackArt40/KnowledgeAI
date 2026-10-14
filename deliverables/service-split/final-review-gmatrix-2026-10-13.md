# 跨阶段总检（G1-G10）放行评审（2026-10-13）

依据 [service-split.md 跨阶段验收矩阵](../../docs/architecture/service-split.md)。**轨道：生产轨道（Java 业务服务）**——G5/G6/G7 为必须项。本评审为阶段 1-6 全部退出后的放行总检，实测基于拆分演练栈（网关 :8088，业务 ×2 副本）与宿主开发服务（:8080）。

## 结论

| ID | 断言 | 生产轨道 | 实测结果 |
|----|------|:---:|---|
| G1 | 浏览器永不直连 Python | ✅ 必须 | **通过** |
| G2 | `/api/v1` 路径与 SSE 事件名兼容 | ✅ 必须 | **通过**（发现并修复缺口，见下） |
| G3 | 跨租户检索 0 hits | ✅ 必须 | **通过** |
| G4 | 对象存储为文件唯一来源 | ✅ 必须 | **通过** |
| G5 | 业务读路径不是进程内存 map | ✅ 必须 | **通过** |
| G6 | 业务多副本 + Redis 撤销生效 | ✅ 必须 | **通过** |
| G7 | Agent + Webhook 签名兼容 | ✅ 必须 | **通过** |
| G8 | 关 AI 开关或停 AI 时有明确错误/回滚 | ✅ 必须 | **通过** |
| G9 | 密钥不进日志与前端 | ✅ 必须 | **通过** |
| G10 | 健康检查存活与就绪分离 | ✅ 必须 | **通过** |

**放行结论：G1-G10 全部通过，生产轨道放行。**

## 逐项证据

### G1 浏览器永不直连 Python ✅

- 网关路由审计（[deploy/nginx.conf](../../deploy/nginx.conf)）：仅两条路由——`/api/` → 业务 upstream、`/` → 前端；无任何指向 ai 的路由；
- compose 端口审计：ai / postgres / redis 均仅 `EXPOSE`（`8000/tcp`、`5432/tcp`、`6379/tcp`），**无宿主端口映射**；k8s 清单 ai = ClusterIP（A6.4）；
- ai 的唯一入口是业务服务持有的 `/internal/*`（`X-Internal-Token`，未配置令牌 = 全部 401 fail-closed，阶段 1 契约）。

### G2 `/api/v1` 路径与 SSE 事件名兼容 ✅（总检发现并修复一处缺口）

- **缺口**：SDK `ask()` 走 `POST /api/v1/chat`，业务服务此前只有 `/api/chat` —— 总检实测暴露；
- **修复**：[ChatController](../../services/business/src/main/java/dev/knowledgeai/business/chat/ChatController.java) 增加 `/api/v1/chat` 别名（同一 SSE 管线；API Key 必须持 `chat:read` scope，对齐 TS v1 路由语义）；`mvn test` 16 全绿后重建镜像；
- **修复后实测**（官方 JS SDK 直连业务服务 :8080）：`ask` → `sources=true, tokens>0, done(conversationId)`；`runAgent` → `status=done, steps=planner,searcher,analyzer` —— **G2_OK**；
- 事件名契约（阶段 4/5 锁定）：chat `sources/token/done`、agent `init/step/done/error/end`，测试断言锁定、未改名。

### G3 跨租户检索 0 hits ✅

- 实测（compose 栈）：向 `ws_other` 插入 KB → ws_default 用户列表**不泄漏**（43 个可见 KB 中无 kb_g3other）→ 直连详情 **404** → 清理；
- Python 租户负例：`pytest -k "tenant or workspace or cross"` **6 passed**（检索/索引/删除三路强制 workspace_id + kb_id 双匹配）；
- Java 读路径全部带 `"workspaceId" = ?` 过滤（KB/文档/任务/搜索/审计，阶段 4-5 逐表落实）。

### G4 对象存储为文件唯一来源 ✅

- compose.split 的 business/ai 服务**无 uploads 卷**（对比单体 compose 的共享 `.uploads`）；文件经 presignedUrl / s3 源（阶段 2）或 base64 内联 → Python 按 mime 解析（阶段 4 binary 路径），无共享磁盘；
- 阶段 2 验收 A2.x 全过（moto 限制项已标注）。

### G5 业务读路径不是进程内存 map ✅（生产轨道必须）

- 代码审计：业务服务全部读路径经 `JdbcTemplate` 查询 PostgreSQL（ADR-0009 红线「PostgreSQL 唯一事实源」）；无任何进程内事实源 map（仅有的进程内集合是 WebhookService 投递记录环形缓冲——纯观测，非读路径事实源）；
- 对照单体：Next 侧 `__KAI_*_STORE__` 内存 Store 仍在，但生产形态下被网关遮蔽（4.10 切换窗口下线）。

### G6 业务多副本 + Redis 撤销生效 ✅（生产轨道必须）

- 多副本：business ×2 healthy，滚动发布零空窗（阶段 6 A6.2/A6.6：71 请求 0 失败）；
- **跨副本撤销实测**（本次总检）：登录获取 jti → 撤销前 `/api/auth/me` 过网关 round-robin ×4 = **200×4** → Redis 写入 `auth:jti:revoked:{jti}` → 再测 ×4 = **401×4** —— 撤销经共享 Redis 对两副本同时生效。

### G7 Agent + Webhook 签名兼容 ✅（生产轨道必须）

- 签名向量：`X-KAI-Signature: sha256=HMAC-SHA256(secret, body)` 小写 hex——Python（tests/test_agent.py）与 Java（WebhookSignTest）双向锁定，含空密钥（WebCrypto 语义，RFC 2104 手工构造）与固定测试向量互验；
- 实测（阶段 5 A5.5）：本地接收器收到 kb.ready / agent.completed / usage.alert，签名本地复算**逐字节一致**；Agent done 帧为完整 AgentTask JSON（业务服务直接透传落库）。

### G8 关 AI 开关或停 AI 时有明确错误/回滚 ✅

- 停 AI 容器实测：chat → **503** `{"error":"AI 服务暂时不可用，请稍后重试","retryable":true}`（不静默回退本地生成——阶段 1 降级语义）；agent → `init + error(worker_offline) + end`（心跳过期后）；
- 恢复后自动回归：chat 全帧序（sources/token/done）、就绪探针 `ok:true`；任务可重试（阶段 5 A5.6 重试闭环）；
- 绞杀式回退开关保留：`AI_SERVICE_URL` 置空 = 单体进程内 RAG。

### G9 密钥不进日志与前端 ✅

- 前端包：A6.5 四层扫描全零（客户端包密钥模式 / 服务端密钥名 / standalone env 文件 / Docker 构建上下文）；
- 日志扫描（只计数不回显）：business 容器日志 JWT 片段（`eyJ`）**0**、`AUTH_SECRET` 名 **0**、内部令牌值 **0**；ai 容器日志内部令牌明文 **0**；
- 机制：Java 日志不打印 token/密钥字段（登录审计只记 actor/action）；Python 结构化日志仅 method/path/status/durationMs/traceId。

### G10 健康检查存活与就绪分离 ✅

- 停 AI 实测：存活 `/api/health` = **200**（进程存活恒 200，依赖无关）；就绪 `/api/health/ready` = **503** + `degraded:["ai"]`（依赖不可达摘流量）；
- k8s/compose 探针接线：startup → liveness（`/actuator/health`、`/api/health`）→ readiness（`/api/health/ready`），AI 侧 `/health` 双探针。

## 放行签署

- **生产轨道放行**：G1-G10 全部通过，其中总检过程发现并修复 1 处 G2 缺口（`/api/v1/chat` 缺失）、1 处 G10 相关真问题（Tomcat 30s 异步超时掐断 SSE，阶段 6 修复）——均经修复后复测确认；
- **遗留生产窗口项**：4.10（Next 业务路由下线与反代切换，步骤见阶段四验收文档第五节）；本机演练栈的 MinIO 以 moto 替代（生产 compose 定义不变）。
