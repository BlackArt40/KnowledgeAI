# 阶段六验收：前端解耦、网关与多实例（2026-10-13）

对应 [service-split.md 阶段 6](../../docs/architecture/service-split.md)（6.1-6.6）。承接阶段五验收（`stage5-acceptance-2026-10-13.md`）。本阶段完成后**阶段 1-6 全部退出**。

## 一、交付物

| 产物 | 说明 |
|---|---|
| [services/business/Dockerfile](../../services/business/Dockerfile) | 业务服务镜像（多阶段：Maven 构建 → JRE 17 运行时；pg profile 进容器；无密钥进层） |
| [docker-compose.split.yml](../../docker-compose.split.yml) | 拆分部署一键起：网关 + 前端 + 业务（`--scale business=N`）+ AI + worker + Postgres + Redis + MinIO；AI/DB/Redis 不映射宿主端口（仅内网） |
| [docker-compose.split.drill.yml](../../docker-compose.split.drill.yml) | 本机演练覆盖：moto S3 兼容层替代 MinIO（本机 Docker Hub 匿名拉取配额耗尽、镜像源不可得；阶段 2 验收同口径）。**生产 minio 定义保持不变** |
| [deploy/nginx.conf](../../deploy/nginx.conf) | 网关：`/api/` → 业务 upstream（多副本 round-robin + `max_fails` 摘除 + `proxy_next_upstream` 故障重试），其余 → 前端；**SSE 硬保证：`proxy_buffering off` + `proxy_read_timeout 3600s`**（6.2/A6.3） |
| [deploy/env.split.example](../../deploy/env.split.example) | 拆分部署环境变量模板（密钥只进运行时 env） |
| [k8s/split.yaml](../../k8s/split.yaml) | 三服务 K8s 清单：gateway(ConfigMap + LoadBalancer 唯一公网入口) / business(×2, Secret 注入) / ai(**ClusterIP，无 NodePort/LoadBalancer**) / app(ClusterIP)；探针 startup/liveness/readiness 齐备 |
| Cookie Secure（6.1） | [AuthController](../../services/business/src/main/java/dev/knowledgeai/business/auth/AuthController.java)：`kai-token` 增加 `Secure` 标志（env `COOKIE_SECURE`，生产 https 必须 true；HttpOnly/SameSite=Lax 恒定）；前端继续同域反代（`NEXT_PUBLIC_API_BASE` 留空 = 同源走网关，Cookie 不跨域） |
| Tomcat 异步超时修复（A6.3 演练暴露） | [application-pg.yml](../../services/business/src/main/resources/application-pg.yml)：`spring.mvc.async.request-timeout: 3600s` —— StreamingResponseBody（chat/agent SSE）受 Tomcat 默认 **30s** 异步超时掐断，实测 25s 保活帧可达、50s 帧丢失后定位；修复后与网关 `proxy_read_timeout` 对齐 |
| 文档（6.6/A6.7） | [overview.md](../../docs/architecture/overview.md) v1.3.0：新增「生产形态：三服务拆分」章节 + **适用版本标注**（单体章节适用 <=1.2.x 与开发模式）；[deployment-guide.md](../../docs/ops/deployment-guide.md) v1.1.0：新增「方式五：三服务拆分部署」（一键起/滚动发布/K8s 审计基线/SSE 网关约束）；[env-vars.md](../../docs/ops/env-vars.md) + `.env.example` 同步拆分变量（parity 门禁 79 变量全一致）；service-split.md v1.2.0（阶段 1-6 完成修订） |

**CI（6.6）**：AI 单测 job 已存在——`ci.yml` `ai-contract` job（Python 3.12，`pip install -e services/ai[dev]` → `pytest services/ai/tests -q`），阶段 5 的 18 个 agent/SSRF/签名用例随该 job 进 CI，无需新增。

## 二、验收标准（A6.1-A6.7）

| 编号 | 标准 | 结果 | 证据 |
|---|---|---|---|
| A6.1 | 生产 compose 一键起：前端、业务、AI、worker、Postgres、Redis、MinIO | ✅ | `docker compose -f docker-compose.split.yml -f docker-compose.split.drill.yml --env-file deploy/.env.split up -d --scale business=2`：9 容器全 healthy（business×2 / app / ai / worker / gateway / postgres / redis / S3）；Flyway 在空库自动 baseline+迁移；过网关冒烟：前端 `/` 200、`/api/health/ready` 全绿（db/redis/ai/agentWorker=alive）、`/api/auth/login` 200（真实 JWT） |
| A6.2 | 杀一个业务 pod，非 SSE 请求可重试成功 | ✅ | 滚动演练中 `docker kill business-1`（流量中）：网关 `proxy_next_upstream` 自动换副本，`/api/auth/me` 持续 200（见 A6.6 时间线，**零失败**） |
| A6.3 | SSE 在网关下 60s+ 不断 | ✅ | agent SSE 过网关长保持实测：`init` 0s → 保活帧 `: ping` 25s / 50s 准点到达（无缓冲攒批）→ 75s 连接仍存活。**发现并修复真问题**：Tomcat 默认 30s 异步超时掐断流（首测 25s 帧可达、50s 帧丢失）→ `spring.mvc.async.request-timeout=3600s` 修复后复测通过；修复后回归：agent 全帧序（init→step×3→done→end）与 chat SSE（sources→token→done）均过网关正常 |
| A6.4 | Python Service 无 NodePort/公网 LB | ✅ | [k8s/split.yaml](../../k8s/split.yaml) 审计：ai 服务 `type: ClusterIP`，无 NodePort/LoadBalancer/Ingress；前端 app 亦 ClusterIP；唯一公网入口 gateway（LoadBalancer）；compose 侧 ai 不映射宿主端口（契约 #1） |
| A6.5 | 密钥只在业务/AI 环境变量，不进前端包 | ✅ | 四层扫描（只输出计数，不回显值）：① `.next/static` 客户端包密钥模式（sk-/AKIA/ghp_/AIza/私钥块等）**0 命中**；② 服务端密钥名（AUTH_SECRET/RESEND_API_KEY/OPENAI_API_KEY/S3_SECRET_KEY/AI_INTERNAL_TOKEN）在客户端包 **0 命中**；③ standalone 产物无 `.env*` 文件；④ `.dockerignore` 含 `.env*`（构建上下文不含密钥）+ `deploy/.env.split` 被 gitignore 覆盖 |
| A6.6 | 蓝绿/滚动期间无「新旧都不可用」空窗 | ✅ | 全自动请求循环（54/min user 档合规频率）跨完整滚动序列：杀 1 副本 → 扩容 3 → 网关 reload → 杀旧副本：**71 请求全部 200（me 与 ready 均 0 失败、0 空窗）**。首轮演练因循环频率打满限流出现 429（限流生效的正确表现，非可用性问题），降频复跑确认 |
| A6.7 | overview 与部署指南已描述三服务，且标明单体文档适用版本 | ✅ | overview.md「生产形态：三服务拆分」+ 单体章节标注「适用 <=1.2.x 与开发模式」；deployment-guide 方式一~四标注单体、方式五为拆分形态；**docs 三门禁全绿**：`pnpm docs:build` ✓、frontmatter 35 文档合法 ✓、env-parity 79 变量一致 ✓ |

**退出条件 A6.1～A6.5 全部满足**；A6.6/A6.7 亦完成。

## 三、工作包落实（6.1-6.6）

| ID | 落实 |
|---|---|
| 6.1 前端环境 | 同域反代（推荐形态）：网关同源 `/api` → 业务，`NEXT_PUBLIC_API_BASE` 留空即同源；Cookie `Secure` env 化 + HttpOnly/SameSite=Lax 恒定 |
| 6.2 网关 | nginx `/api` → 业务 upstream（round-robin + 摘除 + 重试）、其余 → 前端；SSE 关缓冲 + 3600s 读超时 |
| 6.3 多副本 | 业务 ×2（compose `--scale` / k8s `replicas: 2`）；撤销（jti）/限流/Agent 队列全部经 Redis 共享（跨副本语义一致）；AI 服务可水平扩（`agent:queue` BLPOP 多消费者） |
| 6.4 探针 | 业务：startup/liveness `/actuator/health` + readiness `/api/health/ready`（db/redis/ai + agentQueueDepth/agentWorker，降级 503 摘流量）；AI：`/health`；全部接线进 compose healthcheck 与 k8s 探针 |
| 6.5 PWA | 复核通过：`/api/*` network-only（sw.js L151）、kill switch `/sw-config.json`（`disabled:true` → 清缓存 + 反注册）、E4 收窄 precache 仍有效；网关下前端资产可达（`/` 200） |
| 6.6 文档与 CI | AI 单测 job（ai-contract）已在 CI；overview/deployment-guide/env-vars/service-split 四文档同步（见 A6.7） |

## 四、环境约束与偏差记录

1. **MinIO → moto（仅本机演练）**：Docker Hub 匿名拉取配额耗尽（`insufficient_scope`）且各镜像源不可得（daocloud/quay/1ms/xuanyuan 等）；A6.1 演练以 moto S3 兼容层替代（`docker-compose.split.drill.yml`，阶段 2 同口径）。**生产 compose 的 minio 定义不变**，干净机器上直接 `up` 即为 MinIO 全栈。
2. **A6.1「干净机器演练」口径**：本机为「干净状态演练」——全新 compose 项目、空业务库（Flyway 从 baseline 迁移）、无预置进程；宿主机 Docker/缓存复用。真正的异机演练属生产窗口项。
3. **Vue3 重写**：手册标注「可选、不作退出条件」——未执行（目标岗位为 Java/生产轨道）。
4. **首轮演练 429**：限流档位正确生效（60/min user 档），降频后复跑；证明限流在多副本下经 Redis 正确共享。
5. **遗留锚点告警**：`deployment-guide.md` 的 `faq.md#troubleshooting` 锚点告警为既有问题（本阶段 diff 未触及该行）。

## 五、回滚方式

- 拆分栈整体：`docker compose -f docker-compose.split.yml down`；单体回退：`docker compose up -d`（原 compose 未动）；
- 业务服务旁路：网关 `/api` 切回 Next（`AI_SERVICE_URL` 置空则 Python 亦回退单体 RAG）——绞杀式回退开关全程保留；
- 代码层：本阶段无 Prisma 迁移、无 schema 变更；Java 侧新增配置项均有默认值（`COOKIE_SECURE=false`、`request-timeout=3600s`）。

## 六、下一步

**阶段 1-6 已全部退出。** 剩余生产窗口项：4.10（Next 业务路由下线与反代切换，切换步骤见阶段四验收文档第五节）；跨阶段总检按手册「跨阶段验收矩阵」执行（G1-G10，简历轨道 8 项 / 生产轨道 10 项）。
