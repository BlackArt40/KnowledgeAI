---
title: "ADR-0002：后台任务队列"
description: 决策文档处理与 Agent 调研走后台队列，内存队列默认、BullMQ+Redis 可切换，SSE 经事件总线转发
type: explanation
category: architecture
level: L1
version: 1.0.0
authors: [tech-lead]
owner: 技术负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [../overview.md, ../agent-orchestration.md]
---

# ADR-0002：后台任务队列

## 状态

已接受（accepted）

## 背景

文档处理（解析→切片→嵌入→入库，P0-4）与 Agent 调研（四角色编排，可长达数分钟）都是耗时长任务。若在请求线程同步执行：

- 请求超时（平台 / 网关限制），用户体验断裂；
- 长任务阻塞事件循环与连接池，拖垮其他请求；
- 无法水平扩展（多实例需共享任务状态）。

约束条件：

- 保留零依赖演示体验（无 Redis 时进程内可用）；
- 任务需支持重试与失败隔离；
- Agent 进度需实时推送给发起端（SSE）；
- 可演进到独立 worker 进程（Docker `worker` 服务）。

## 决策

采用**可插拔双后端任务队列**：

1. **抽象层**：`src/lib/queue/index.ts` 工厂 + Agent 事件总线（发布/订阅，供 SSE 转发）；
2. **内存队列**（默认，`REDIS_URL` 未配置）：进程内 EventEmitter，重试 3 次指数退避（`memory-queue.ts`），首次入队自动启动（HMR 安全，`globalThis.__KAI_QUEUE_INSTANCE__` 单例）；
3. **BullMQ + Redis**（`REDIS_URL` 已配置）：多实例、独立重试与死信队列（DLQ）、独立 worker 进程（`worker.ts` + Docker `worker` 服务），Agent 事件经 Redis Pub/Sub 跨进程转发（`agent-bus-redis.ts`）；
4. **任务注册**：`handlers.ts` 的 `registerAllHandlers()` 统一注册；新增任务类型 = `JobType` 联合类型 + handler + 注册 + 路由入队。

任务类型：`doc-process`、`agent-run`、`index-cleanup`、`webhook-deliver`。

**Agent SSE 流**：`/api/agent/run` 入队 `agent-run` 后打开 SSE 订阅事件总线；worker 执行 `runTask` 并发布 `step` / `done` / `error` / `end` 事件，route handler 转发。事件名被测试断言，**禁止改名**。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| 请求线程同步执行 | 长任务阻塞、超时、无法水平扩展（见背景） |
| 定时轮询任务表 | 延迟高、实现笨重、无事件推送能力 |
| 仅 BullMQ（不保留内存后端） | 破坏无 Redis 的演示模式；本地开发体验退化 |
| 引入消息中间件（Kafka/RabbitMQ） | 对当前规模过度设计；BullMQ 已覆盖重试/DLQ/多实例 |

## 后果

**正面**

- 请求线程零阻塞，长任务异步完成；
- 内存 / Redis 双后端覆盖「演示 → 生产」全谱系，配置即切换；
- 多实例与独立 worker 成为可能（事件总线跨进程）；
- 重试 + DLQ 保障任务可靠性，失败有据可查。

**负面 / 约束**

- 两套后端需维护行为一致性（内存模式无持久化、重启丢任务——可接受，演示定位）；
- 内存模式下任务在进程内，SSE 依赖同进程 EventEmitter；
- 事件协议（`init`/`step`/`done`）成为稳定契约，变更需同步测试与前端。

**回滚方式**

- 移除 `REDIS_URL` 即回到内存队列，无代码变更；
- 任务处理器与队列后端解耦，替换后端不影响业务代码。

## 相关 ADR

- [ADR-0001：内存存储 + 写穿数据库](adr-0001-in-memory-store-write-through-db.md)
