---
title: "ADR-0008：AI 服务框架选型"
description: Python AI 服务框架决策：FastAPI 承载接口、RAG 管线裸写不引入编排框架、LangGraph 仅用于 Agent 四角色流水线、arq 作任务队列并与 QUEUE_MAX_DEPTH 背压语义对齐
type: explanation
category: architecture
level: L1
version: 1.1.0
authors: [tech-lead]
owner: 技术负责人
reviewed_at: 2026-10-12
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [../service-split.md, adr-0002-background-job-queue.md, adr-0007-queue-backpressure.md]
---

# ADR-0008：AI 服务框架选型

## 状态

已接受（accepted）

## 背景

[服务拆分实施手册](../service-split.md)阶段 1 需新建 Python AI 服务（`services/ai/`），阶段 5 将 Agent 四角色研究流水线迁入。开工前需要一次性定清框架边界：Web 框架、RAG 管线是否用编排框架、Agent 用什么、任务队列用什么。

约束来自三处：

- 对外契约不可变：检索返回结构必须对齐现有 `RetrievedChunk`，SSE 事件名必须是 `sources` / `token` / `done`（Agent 为 `init` / `step` / `done` / `error` / `end`）；
- 租户契约：所有检索/索引入参强制携带 `workspaceId`（ADR-0003），框架不得把鉴权语义藏进抽象层；
- 单人维护预算：引入的每个框架都要付出学习、版本跟进与调试成本。

国内同类系统的常见路线：平台化低代码（Dify / FastGPT / Coze）、LangChain 全家桶、LlamaIndex、国产框架（Qwen-Agent / AgentScope）、完全裸写。

## 决策

1. **Web 框架：FastAPI + uvicorn**。SSE 原生支持（`StreamingResponse`）、Pydantic 模型即接口契约、与 OpenAPI 冻结基线（阶段 0.1）天然对齐。

2. **RAG 管线（阶段 1～3）：裸写，不引入 LangChain / LlamaIndex**。解析 → 切片 → 嵌入 → 混合检索 → 重排 → 生成是确定性数据流，不是图/状态机；编排框架在这里只增加抽象层、版本风险与调试成本。接口即契约：`/internal/index`、`/internal/retrieve`、`/internal/chat/stream` 直接用 Pydantic 模型对齐现有结构。

3. **Agent 编排（阶段 5）：采用 LangGraph，但划定边界**。四角色研究流水线需要状态机式编排、checkpoint 断点续跑、human-in-the-loop 预留，LangGraph 是该场景当前主流且简历认可度最高。**边界约束：LangGraph 依赖仅允许出现在 agent 模块（`/internal/agent/run` 路径），RAG 路径（index / retrieve / chat）禁止引入**；pyproject 中锁定版本。

4. **任务队列：arq（asyncio 原生，复用 Redis）**。入队前实施深度上限检查，语义与 [ADR-0007](adr-0007-queue-backpressure.md) 的 `QUEUE_MAX_DEPTH` 对齐（`waiting + delayed` 口径、超限拒绝并给可重试提示）；死信与复杂重试策略超出 arq 能力时再评估 Celery，切换点封装在队列模块内。

5. **LLM 客户端：OpenAI 兼容 SDK 直连**（DeepSeek / 通义 / 硅基流动），与现网 `src/lib/llm/provider.ts` 的抽象保持同一网关形态，不在 Python 侧再引入一层封装框架。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| Dify / FastGPT / Coze 平台化 | 交付快，但编排黑盒、自持困难；与现有 RBAC / 租户 / SSE 契约耦合差。国内 ToB 交付常见，适合另起平台而非嵌入本架构 |
| LangChain 全家桶（含 RAG） | 抽象层厚、版本迭代剧烈；RAG 是确定性数据流，不需要编排语义 |
| LlamaIndex | 检索组件成熟，但检索必须严格对齐 `RetrievedChunk` / SSE 契约，引入收益低于自持管线 |
| Qwen-Agent / AgentScope | 偏特定生态与多智能体场景，社区规模与简历认可度低于 LangGraph |
| Agent 也裸写 | 可控性最高，但四角色流水线的状态管理、断点续跑自研成本高，超出单人维护预算 |

## 后果

**正面**

- RAG 路径零框架依赖，契约（`RetrievedChunk`、SSE 事件名、租户三元组）完全自持；
- Agent 获得成熟的编排、checkpoint 与可视化调试能力；
- Python 侧队列背压与 TS 侧语义一致，`/api/health/ready` 的 `queueBackpressured` 口径不分裂。

**负面 / 约束**

- 「裸写 + LangGraph」双心智并存，code review 需守住「LangGraph 不进 RAG 路径」的边界；
- LangGraph 版本迭代快，锁版本后有升级维护成本；
- arq 生态小于 Celery，复杂调度需求出现时可能迁移（切换点已封装）。

**回滚方式**

- LangGraph 限定在 agent 模块内、对外仅有 `/internal/agent/run` 一个入口，可整体替换实现而不影响 RAG 路径；
- RAG 管线无框架依赖，无回滚成本；
- arq → Celery 迁移封装在队列模块内，按 [ADR-0007](adr-0007-queue-backpressure.md) 的调用方语义分级即可替换。

## 相关 ADR

- [ADR-0002：后台任务队列](adr-0002-background-job-queue.md)
- [ADR-0007：队列背压](adr-0007-queue-backpressure.md)
- [服务拆分实施手册](../service-split.md)

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-10-12 | 初版：FastAPI + 裸写 RAG + LangGraph（仅 agent）+ arq |
| 1.1.0 | 2026-10-13 | 阶段 5 实施修订：任务队列由 arq 调整为语言中立 Redis List（`agent:queue`，Java 业务服务 LPUSH / Python worker BLPOP）。原因：手册 5.1 确定生产者在 Java 侧，arq 的入队 wire format 为私有协议（msgpack + 自有元数据），Java 直写会与 arq 内部版本强耦合。`QUEUE_MAX_DEPTH` 入队前深度检查、超限拒绝（429 `queue_busy`）的 ADR-0007 背压语义保持不变；切换点封装在 `services/ai/app/agentqueue.py`（enqueue/queue_depth），后续若引入 Celery 等仍在该模块内替换。LangGraph 仅限 agent 模块的边界在实施中由 import 管辖（`app/agent.py` 唯一 import 方） |
