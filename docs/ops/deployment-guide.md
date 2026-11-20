---
title: 部署指南
description: KnowledgeAI 部署手册：三服务拆分部署（网关/业务/前端/AI）、Docker Compose 单机、CI Staging 自动部署、生产蓝绿切换与 Kubernetes
type: how-to
category: ops
level: L2
version: 1.3.2
authors:
  - technical-writer
owner: devops-owner
reviewed_at: 2026-11-05
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

**三服务拆分形态（>=1.3.0，服务拆分阶段 6 起的生产形态，见“方式五”）**：

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

**单体形态（<=1.2.x，单机部署 / 演示模式，方式一～四）**——生产部署由 **4 个服务**组成：

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
- **适用版本**：方式一～四描述单体形态；拆分生产形态（网关 + 业务 + 前端 + AI）见“方式五”。

## 方式一：Docker Compose（单机部署）

> **本地开发不使用 Docker。** 开发机直接跑 `pnpm install` → `pnpm dev`（Next 纯 API `:3000`，演示模式无需任何环境变量）+ `pnpm -C frontend dev`（Vue 页面 `:5173`，`/api` 经 vite 代理到 `:3000`）；需要验证构建产物时用 `pnpm -C frontend build && pnpm -C frontend exec vite preview --port 4173`。本方式用于单机部署或验证镜像/编排产物，日常开发迭代不需要启动 compose。

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

**前置配置**(GitHub Secrets)：`STAGING_HOST` / `STAGING_USER` / `STAGING_SSH_KEY`。未配置时 staging job 自动跳过（镜像仍构建推送）。

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
- `securityContext.fsGroup: 1001`：让 uploads PVC 可被 nextjs(uid 1001)写入，避免 EACCES；
- **worker 单独部署**（同一镜像，command 覆盖为 `node worker.js`），否则队列任务无人消费；
- uploads 卷：单节点用 ReadWriteOnce PVC；**多节点/多副本必须二选一**：
  1. 换支持 **ReadWriteMany** 的存储类（NFS/CephFS 等）——直传与后台解析都可用；
  2. 改用**对象存储**（`S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`）——分片上传链路直接读写 S3/MinIO，不落本地盘。
     注意：直传（非分片）上传与后台解析仍读写本地 `.uploads`，选方案 2 时需把上传统一走分片链路，或保留 RWX 卷。

## 方式五：Vue 静态前端 + Next API（当前形态）

拆分线（Java/Python/nginx 切流）已于 2026-11-20 退役，仓库不再提供 split compose、K8s split 或切流脚本。

生产方式：

1. `pnpm -C frontend build` 产出 `frontend/dist`（含预渲染 `home.html`）。
2. 由任意静态服务器/CDN 托管 `frontend/dist`：`/` 优先 `home.html`，其余 SPA fallback 到 `index.html`，`/assets/*` 长缓存。
3. `/api/*` 反代到 Next（默认 `:3000`）；`/vendor/*`、`/widget/*`、`/sw.js` 等根 `public/` 资产由 Next 或静态层兜底。
4. SSE 需关闭代理缓冲并放宽读超时；`AGENT_STREAM_TIMEOUT_SECONDS` 控制 Agent 流空闲硬超时。
5. 数据库迁移只用 Prisma：`npx prisma migrate deploy`。

回滚：静态产物与 Next 镜像分开发布，回滚任一层即可；不再有“回退到 Next 页面”的概念。

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
| 1.1.0 | 2026-10-13 | 服务拆分阶段 6：新增“方式五：三服务拆分部署”（compose 一键起 / 滚动发布 / k8s 拆分清单 / SSE 网关约束），部署架构区分单体（<=1.2.x）与三服务形态并标注适用版本 |
| 1.2.0 | 2026-10-13 | 新增“生产切换窗口（4.10）”部署时操作：前置预检清单、切流/观察/代码下线步骤、验证清单与回滚预案（承接阶段 1～6 验收与 G1-G10 总检结论） |
| 1.3.0 | 2026-10-16 | 前端绞杀重写 V1(Vue 3 + Element Plus + Vite)：新增“前端切流与回退”节——deploy/nginx/routes.conf 单一事实源 + scripts/deploy/switch-frontend.sh 唯一入口（apply/rollback/revert-all，nginx -t 失败自动回写占位）；compose 网关挂载 switch conf 与 frontend/dist |
| 1.3.1 | 2026-10-30 | 明确本地开发不使用 Docker（`pnpm dev` + `pnpm -C frontend dev`，无需环境变量），“方式一”由“本地 / 单机”改为“单机部署”；同步删除本地已作废的 compose override(3000→nginx / 3001→app) |
| 1.3.2 | 2026-11-05 | 前端切流节页面数 28 → 30（`frontend/src/router/index.ts`）；`routes.conf` 仍为 28 条切流规则，两者口径分开表述 |
