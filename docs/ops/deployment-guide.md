---
title: 部署指南
description: KnowledgeAI 部署手册：三服务拆分部署（网关/业务/前端/AI）、Docker Compose 单机、CI Staging 自动部署、生产蓝绿切换与 Kubernetes
type: how-to
category: ops
level: L2
version: 1.2.0
authors:
  - technical-writer
owner: devops-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related:
  - env-vars.md
  - monitoring.md
  - ../faq/faq.md
---

# 部署指南

> 本文介绍 KnowledgeAI 的部署方式与升级/回滚流程。开始前请先阅读[环境变量全表](env-vars.md)完成配置。

## 部署架构

**三服务拆分形态（>=1.3.0，服务拆分阶段 6 起的生产形态，见「方式五」）**：

```mermaid
flowchart LR
  C["浏览器 / SDK"] --> GW["网关 nginx<br/>/api → 业务（多副本）<br/>其余 → 前端"]
  GW --> BIZ["业务服务（Java ×N）"]
  GW --> FE["前端（Next）"]
  BIZ --> AI["AI 服务（Python，仅内网）"]
  BIZ --> PG[("PostgreSQL")]
  BIZ & AI --> RD[("Redis")]
  AI --> VDB[("向量库")]
  BIZ --> S3[("S3 / MinIO")]
```

**单体形态（<=1.2.x，本地开发 / 演示模式默认，方式一~四）**——生产部署由 **4 个服务**组成：

| 服务 | 镜像/来源 | 职责 | 说明 |
|------|-----------|------|------|
| `app` | 自建（`Dockerfile`） | Next.js standalone 服务 | 对外 :3000，生产者 |
| `worker` | 同镜像，命令 `node worker.js` | 消费队列（doc-process / agent-run / index-cleanup） | **必须部署**，否则队列任务无人处理 |
| `redis` | `redis:7-alpine` | 限流 / 队列 / 事件总线 | 可外部化（`REDIS_URL`） |
| `postgres` | `pgvector/pgvector:pg16` | 持久化 + 向量检索 | 可外部化（`DATABASE_URL`） |

**关键约束**：
- `app` 与 `worker` **共享上传目录**（`/app/.uploads` 卷），worker 需要读取 app 写入的文档文件；
- 容器内 `localhost` 是容器自己，`DATABASE_URL` / `REDIS_URL` 必须指向服务名或外部地址（见 [FAQ](../faq/faq.md)）；
- 未配置 `DATABASE_URL` / `REDIS_URL` 时应用自动回退演示模式（数据不持久化）；
- **适用版本**：方式一~四描述单体形态；拆分生产形态（网关 + 业务 + 前端 + AI）见「方式五」。

## 方式一：Docker Compose（本地 / 单机）

```bash
# 1. 准备环境变量
cp .env.example .env.local
# 编辑 .env.local：至少设置 AUTH_SECRET；DATABASE_URL/REDIS_URL 留空走演示模式

# 2. 构建并启动全部服务（app + worker + redis + postgres）
docker compose up -d --build

# 3. 验证
curl http://localhost:3000/api/health        # 存活探针：{"status":"ok",...}
curl http://localhost:3000/api/health/ready  # 就绪探针：200 ok 或 503 degraded

# 4. 启用数据库持久化（可选）
# vector 扩展由应用首次检索时自动创建（CREATE EXTENSION IF NOT EXISTS vector）；
# 若角色无建扩展权限，DBA 手动执行一次即可：
docker compose exec postgres psql -U user -d knowledgeai -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 运行镜像只含 Next standalone 产物（不含 Prisma CLI），迁移与种子在宿主机执行，
# 通过 compose 暴露的 5432 端口直连（容器内地址是 postgres:5432，宿主机是 localhost:5432）：
export DATABASE_URL="postgresql://user:knowledgeai-dev@localhost:5432/knowledgeai"
npx prisma migrate deploy
npx prisma db seed   # 写入演示数据（可选）
```

- `KAI_ENV_FILE` 可指定其他环境文件（如服务器部署用 `.env`）；
- `docker compose down` 停止；数据保留在命名卷（`redis-data` / `postgres-data` / `uploads`）；
- `RATE_LIMIT_PER_MIN` 等档位可通过环境变量覆盖（性能测试需调高）。

## 方式二：Staging 自动部署（CI）

push `main` 触发 `.github/workflows/deploy.yml`：构建镜像推 GHCR → SSH 到服务器执行 `scripts/deploy/staging.sh <image> <compose-dir>`。

**前置配置**（GitHub Secrets）：`STAGING_HOST` / `STAGING_USER` / `STAGING_SSH_KEY`。未配置时 staging job 自动跳过（镜像仍构建推送）。

服务器侧 `staging.sh` 流程：
1. `docker pull` 新镜像（GHCR）；
2. 幂等拉起依赖（redis / postgres，首次自动创建）；
3. `docker compose up -d --no-deps` 更新 app + worker（`KAI_ENV_FILE` 默认 `.env`）；
4. 等待 Docker 内置 HEALTHCHECK 通过。

## 方式三：生产蓝绿部署（手动 + 审批门）

`.github/workflows/deploy-prod.yml`（workflow_dispatch 手动触发，`production` environment **必需评审人审批**）：

1. 指定镜像 tag（留空用 main 最新构建）；
2. 构建推 GHCR → SSH 执行 `scripts/deploy/blue-green.sh <image>`。

蓝绿切换逻辑（`scripts/deploy/blue-green.sh`）：

```mermaid
flowchart LR
  A["拉取新镜像"] --> B["blue 容器启动<br/>备用端口 + 健康检查(60s)"]
  B -->|通过| C["接管 :3000<br/>旧容器改名 GREEN-old 保留"]
  B -->|失败| D["自动回滚<br/>旧容器继续服务"]
  C --> E["（可选）同步 worker<br/>KAI_WORKER_IMAGE"]
```

- 新版本先在备用端口健康检查通过后才接管对外端口，**不会出现新旧都不可用空窗**；
- 任一步骤失败自动回滚（退出码 1，旧版本仍在服务）；
- **回滚方式**：重新触发 workflow 并指定上一个镜像 tag。

## 方式四：Kubernetes

> ⚠️ **示例清单，不可直接用于生产**：`k8s/deployment.yaml` 仅演示探针与卷的接线方式。
>
> **扩容前置条件状态（2026-10-08）**：① 鉴权/撤销读路径已共享化（F5：apiKey 未命中回源 DB + jti 黑名单经共享 Redis 跨实例生效；**多副本必须配置 `REDIS_URL`**，详见 [ADR-0006](../architecture/adr/adr-0006-read-path-storage-evolution.md)）；② uploads 卷仍为 RWO，**多节点/多副本必须改 RWX 或对象存储**；③ 队列深度背压已上线（`QUEUE_MAX_DEPTH` + 就绪探针 `queueBackpressured`，详见 [ADR-0007](../architecture/adr/adr-0007-queue-backpressure.md)）。
>
> **② 完成之前，app 必须保持 `replicas: 1`。**

示例清单 `k8s/deployment.yaml`（替换镜像占位符后 apply；仅限单副本试用/联调）：

```bash
kubectl apply -f k8s/deployment.yaml
```

要点：
- **三探针语义**：`startupProbe`（启动容错）→ `livenessProbe`（`GET /api/health`，进程存活，恒 200）→ `readinessProbe`（`GET /api/health/ready`，依赖连通，503 摘流量）；
- `securityContext.fsGroup: 1001`：让 uploads PVC 可被 nextjs（uid 1001）写入，避免 EACCES；
- **worker 单独部署**（同一镜像，command 覆盖为 `node worker.js`），否则队列任务无人消费；
- uploads 卷：单节点用 ReadWriteOnce PVC；**多节点/多副本必须二选一**：
  1. 换支持 **ReadWriteMany** 的存储类（NFS/CephFS 等）——直传与后台解析都可用；
  2. 改用**对象存储**（`S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`）——分片上传链路直接读写 S3/MinIO，不落本地盘。
     注意：直传（非分片）上传与后台解析仍读写本地 `.uploads`，选方案 2 时需把上传统一走分片链路，或保留 RWX 卷。

## 方式五：三服务拆分部署（>=1.3.0，生产形态）

服务拆分阶段 6 产物（[service-split.md](../architecture/service-split.md) 6.1-6.3）：**网关(nginx) → 业务服务(Java ×N 副本) + 前端(Next) + AI 服务(Python)**，AI 仅内网可达（浏览器永不直连 Python）。前端继续**同域反代**（手册 6.1 推荐）：`NEXT_PUBLIC_API_BASE` 留空，浏览器只见网关一个源，Cookie 不跨域。

### Docker Compose 一键起（A6.1）

```bash
# 1. 准备环境变量（密钥只进运行时 env，不进构建产物）
cp deploy/env.split.example deploy/.env.split
# 编辑 deploy/.env.split：至少设置 AUTH_SECRET / AI_INTERNAL_TOKEN

# 2. 一键起全栈（网关 + 前端 + 业务 + AI + worker + Postgres + Redis + MinIO）
docker compose -f docker-compose.split.yml --env-file deploy/.env.split up -d --build

# 3. 业务多副本（6.3：业务 ≥2 副本，撤销/限流/Agent 队列经 Redis 共享）
docker compose -f docker-compose.split.yml --env-file deploy/.env.split up -d --scale business=2

# 4. 验证（网关默认 :8088，GATEWAY_PORT 可改）
curl http://localhost:8088/api/health/ready   # 业务就绪（db/redis/ai/agentQueue/worker）
curl -X POST http://localhost:8088/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'
```

> 本机无 MinIO 镜像时的演练替代：叠加 `-f docker-compose.split.drill.yml`（moto S3 兼容层，阶段 2 验收同口径）。生产定义保持 `minio` 不变。

### 滚动发布（A6.2/A6.6：全程无空窗）

```bash
# 1. 先扩一个新副本并等健康
docker compose -f docker-compose.split.yml --env-file deploy/.env.split up -d --scale business=3
# 2. 网关优雅 reload（重新解析 upstream，不中断在途请求）
docker compose -f docker-compose.split.yml --env-file deploy/.env.split exec gateway nginx -s reload
# 3. 停一个旧副本（nginx proxy_next_upstream 对 error/502/503 自动换副本重试）
# 4. 缩回目标副本数并再次 reload
```

### Kubernetes（A6.4 清单审计基线）

`k8s/split.yaml`：三服务 + 网关清单，镜像占位符替换后 `kubectl apply -f k8s/split.yaml`（基础设施沿用 `k8s/deployment.yaml` 的 Postgres/Redis/MinIO 部分）。审计要点：

- **AI 服务 = ClusterIP**：无 NodePort / 无 LoadBalancer / 无 Ingress（Python 不对公网）；
- 前端 `app` 亦为 ClusterIP，**唯一公网入口是 gateway**（LoadBalancer）；
- 探针：业务 startup/liveness `/actuator/health` + readiness `/api/health/ready`（DB/Redis/AI/Agent 队列降级即摘流量）；AI liveness/readiness `/health`；
- 密钥经 Secret（`knowledgeai-runtime`）注入运行时环境变量，镜像构建不含密钥。

### SSE 与网关（A6.3）

网关配置（[deploy/nginx.conf](../../deploy/nginx.conf)）对 `/api/` 强制 `proxy_buffering off` + `proxy_read_timeout 3600s`，SSE（chat / agent-run）长流不缓冲、不掐断；业务侧 `spring.mvc.async.request-timeout=3600s` 对齐（Tomcat 默认 30s 异步超时会掐断长流——A6.3 演练实测暴露并已修复）。

### 生产切换窗口（4.10：Next 业务 API 下线，部署时操作）

服务拆分阶段 1-6 + 总检 G1-G10 全过后，生产入口仍指向单体（Next 承载业务 API）。本节是**上线窗口的执行手册**——把业务 API 正式切到业务服务并下线 Next 内业务路由（手册 [4.7/4.10](../architecture/service-split.md)，单次操作，约一个观察日 + 一个代码日）。

**前置预检（全绿才开工）**：

- [ ] 阶段 1-6 验收 + G1-G10 总检全过（评审记录：仓库 `deliverables/service-split/final-review-gmatrix-2026-10-13.md`）；
- [ ] 拆分栈已在生产就位（方式五），`business ≥ 2` 副本、Redis 共享（撤销/限流/队列跨副本生效）；
- [ ] 功能等价抽测通过：登录/2FA、KB CRUD、文档上传（同步 + binary 异步状态机）、chat/agent SSE、webhook 验签、分享链接语义码；
- [ ] 数据库：Flyway 已迁移至最新（baseline 17 + 后续迁移），生产窗口内 Prisma 不再执行迁移；
- [ ] 生产配置就位：`AUTH_SECRET`（与历史一致）、`AI_INTERNAL_TOKEN`、`CORS_ALLOWED_ORIGINS`（显式白名单）、`COOKIE_SECURE=true`；
- [ ] 观测就位：`/api/health/ready` 告警、业务日志（Loki/结构化）、webhook 投递记录可查。

**切换步骤**：

1. **切流**：生产入口（DNS/LB/Ingress）指向拆分网关。切流即影子——网关把 `/api` 路由到业务服务，Next 内同名业务 handler 从此不接收生产流量（手册 4.10 的「停写内存、只写 DB」天然成立：DB 本就是写穿目标，业务服务直接读写同一库）。前端同域：`NEXT_PUBLIC_API_BASE` 留空，浏览器只见网关一个源，Cookie 不跨域；
2. **观察 24h**：`/api/health/ready` 无 P0（AI 降级 503 属预期内自愈，不算 P0）；抽样验证登录/2FA、chat/agent SSE 帧序、webhook 验签、限流 429 与 `Retry-After`、撤销 401 跨副本生效；
3. **代码下线**（24h 无 P0 后执行）：
   - 代码搜索门禁：`grep -rn "__KAI_.*_STORE__" src/` —— 生产路径读取必须清零（业务 handler 删除后自然清零；测试/脚本引用单独评估）；
   - 删除 Next 内业务 handler（`src/app/api/**` 中已被网关接管的业务路由；手册允许「改为 301 到业务服务或删除」，推荐删除——入口已在网关，Next 内无需重定向层）；
   - 保留 Next 的页面/静态/PWA 职责（前端继续由网关 `/` 服务）；
4. **收尾**：更新 [overview.md](../architecture/overview.md) 的适用版本标注（单体形态仅存于版本历史）；`AI_SERVICE_URL` 保持开启（前端内置的 chat 兜底逻辑不再有业务 API 可达，回退开关即网关注释切换）。

**验证清单（切流后立即 + 24h 各跑一轮）**：登录/2FA 双分支、失败锁定、API Key scope 403、KB CRUD + 成员角色 PATCH + 审计链、文档索引状态机（ready/failed/轮询）、chat SSE（sources/token/done）、agent SSE（init/step/done/error/end）、webhook 三事件验签、分享链接 401/403/200/410、限流 429 + Retry-After——逐项对应各阶段验收文档的实测命令。

**回滚预案（任一步可执行，无数据破坏）**：

- 切回单体：生产入口 DNS/LB 指回 Next 单体入口即可——单体与业务服务读写同一 PostgreSQL（Flyway 只增不改历史表），内存 Store 水合即恢复原读路径；
- 代码下线后回滚：`git revert` 恢复 Next 业务 handler（代码在版本库），重新部署单体；
- `flyway_schema_history` 表仅记录基线，删除该表即回到 Prisma 单一治理（不推荐，仅数据层审计用）。

## 前端切流与回退（V1 起，Vue 3 绞杀重写；V6 已全量接管）

`frontend/`（Vue 3 + Element Plus + Vite，pnpm workspace 包 `kai-frontend`）已**全量接管 28 个页面**（V6 起 Next 页面层已删除，Next 仅服务 `/api/**` 与 `public/` 静态资产）。已迁移路由清单维护在 `deploy/nginx/routes.conf`（单一事实源，现 27 条），切换唯一入口是 `scripts/deploy/switch-frontend.sh`；switch conf 为空时全部页面流量走 Next 兜底（`location /`，仅 API 与静态资产有意义——页面兜底只在回滚到 V5 之前代码时才成立），`/api/*` 反代业务服务的配置不受前端切流影响。首页 `location = /` 优先返回构建期预渲染的 `dist/home.html`（SEO 静态首帧，产物缺失自动回退 SPA index.html）。

### 前置

```bash
pnpm -C frontend build     # 产出 frontend/dist（compose 挂载为网关 /srv/vue，只读）
```

### 切流

```bash
# 1. 编辑 deploy/nginx/routes.conf：追加（或删除）已迁移路径；
#    精确路由写 /path，动态段路由写 /prefix/*（如 /share-doc/*）
# 2. 应用（自动备份当前 routes.conf 到 routes.conf.bak → 生成 switch conf
#    → 网关内 nginx -t 校验 → reload；校验失败自动回写占位 conf 并 reload）
scripts/deploy/switch-frontend.sh apply
```

### 回退（任一，秒级、无状态）

```bash
scripts/deploy/switch-frontend.sh rollback    # 恢复上一次 apply 前的 routes.conf
scripts/deploy/switch-frontend.sh revert-all  # 清空路由：页面流量回 Next 兜底
```

> V6 起 Next 已无页面层——revert-all 只在回滚到 V5 之前代码（Next 仍带页面）时才成立；
> 当前形态下它仅用于演练/状态还原（未知页面路径由 Next 404）。

### 验证

- 已切页面返回 Vue 首帧（HTML 含 `id="app"`，静态资源走 `/assets/`，与 `/_next/static` 不冲突）；
- 未切页面路径由 Next 兜底 404（V6 起 `location /` 仅服务 `/api/**` 与 `public/` 静态资产——vendor/widget/PWA 单源）；
- 登录会话有效：`kai-token` Cookie 由服务端 Set-Cookie 签发，Vue 页面与 `/api/**` 同域共享；
- `clean-machine-drill.sh` 内置 5.5 切流演练段：apply → Vue 断言 → revert-all → Next 断言 → 状态还原。

## 升级与回滚

| 场景 | 操作 |
|------|------|
| 常规升级 | 构建新镜像 → compose 更新（方式一/二）或蓝绿切换（方式三） |
| 回滚 | 方式三：重新触发 workflow 指定旧 tag；方式一/二：`docker compose up -d <旧镜像>` |
| 数据库迁移 | 升级前在宿主机执行 `DATABASE_URL=... npx prisma migrate deploy`（运行镜像不含 Prisma CLI，迁移文件在仓库 `prisma/migrations/`） |
| 降级处理 | 演示模式与生产模式可随时互切（移除/设置 `DATABASE_URL` 即可） |

### 认证兼容性预检

升级包含 API Key scope 收紧或 Agent 报告分享默认关闭的版本前：

1. 用只读数据库连接执行 `DATABASE_URL=... npx tsx scripts/audit-auth-compat.ts`。
2. 如果出现 `legacy_null > 0`，这些历史任务在升级后默认返回 403。不要批量自动放开；只对已确认原本就作为公开链接使用、且经业务审核的任务显式设置 `shareConfig = {"enabled": true, "views": 0}`。
3. API Key 调用日志目前不落库。通过 Loki/结构化日志检查 `dimension=apikey` 且 `path` 不在 `/api/v1/` 下的调用；升级前将这类客户端迁移到 `/api/v1/*`。
4. 确认以下边界后再发布：
   - 内部 API 只接受 JWT 会话；
   - API Key 只用于 `/api/v1/*` 且按 scope 校验；
   - Agent 报告 `shareConfig` 缺失或 `enabled !== true` 时不可匿名访问。

## 部署自检清单

- [ ] `AUTH_SECRET` 已设置为随机 32+ 字符
- [ ] `DATABASE_URL` / `REDIS_URL` 指向正确（容器内非 localhost）
- [ ] app 与 worker 共享 uploads 卷
- [ ] `/api/health` 与 `/api/health/ready` 探针可达
- [ ] 生产环境已配置 `production` environment 审批门与 SSH secrets
- [ ] 生产镜像 tag 可回滚（记录上次成功 tag）
- [ ] 已执行认证兼容性预检，并完成历史分享链接与旧版 API Key 客户端迁移决策

## 相关文档

- [环境变量全表](env-vars.md)
- [监控与告警](monitoring.md)
- [常见问题与故障排查](../faq/faq.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 Dockerfile / compose / 部署脚本 / k8s 清单核对） |
| 1.1.0 | 2026-10-13 | 服务拆分阶段 6：新增「方式五：三服务拆分部署」（compose 一键起 / 滚动发布 / k8s 拆分清单 / SSE 网关约束），部署架构区分单体（<=1.2.x）与三服务形态并标注适用版本 |
| 1.2.0 | 2026-10-13 | 新增「生产切换窗口（4.10）」部署时操作：前置预检清单、切流/观察/代码下线步骤、验证清单与回滚预案（承接阶段 1-6 验收与 G1-G10 总检结论） |
| 1.3.0 | 2026-10-16 | 前端绞杀重写 V1（Vue 3 + Element Plus + Vite）：新增「前端切流与回退」节——deploy/nginx/routes.conf 单一事实源 + scripts/deploy/switch-frontend.sh 唯一入口（apply/rollback/revert-all，nginx -t 失败自动回写占位）；compose 网关挂载 switch conf 与 frontend/dist |
