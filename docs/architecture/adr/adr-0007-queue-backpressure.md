---
title: "ADR-0007：队列背压"
description: 任务队列入队侧实施深度背压：QUEUE_MAX_DEPTH 达上限即拒绝新任务（可重试语义），就绪探针暴露 queueBackpressured；存量积压仍由人工巡检处置
type: explanation
category: architecture
level: L1
version: 1.0.0
authors: [tech-lead]
owner: 技术负责人
reviewed_at: 2026-10-08
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [../overview.md, adr-0002-background-job-queue.md, adr-0006-read-path-storage-evolution.md]
---

# ADR-0007：队列背压

## 状态

已接受（accepted）

## 背景

[ADR-0002](adr-0002-background-job-queue.md) 引入的后台队列（内存 / BullMQ 双后端）没有入队上限：当 worker 消费能力不足（宕机、Redis 故障、任务变慢）时，积压无界增长——

- 内存队列：待处理 job（含 payload）常驻进程内存，1Gi 容器 limit 下持续攀升直至 `OOMKilled`；
- BullMQ：积压堆在 Redis，worker 内存与事件延迟同样随积压恶化；
- 触发时**没有明确信号**：生产者继续入队成功，用户看到任务永远排队，运维只能靠人工巡检发现（审计 X5/X6）。

2026-09 审计将"队列加入深度/内存背压"列为扩容前置条件之一。本 ADR 记录落地决策：**在入队侧实施深度背压（fail-fast），配合就绪探针的背压信号**；存量积压的自动处置暂不建设。

## 决策

1. **入队上限 `QUEUE_MAX_DEPTH`（默认 500，按队列计）**：口径为 `waiting + delayed`（等待执行 + 等待重试）；达到上限后 `enqueue()` 抛出 `QueueBackpressureError`（`code: "queue_full"`，含 depth/maxDepth）。
   - 两个后端行为一致：内存队列统计 `status === "queued"` 的 job；BullMQ 用 `getJobCounts("waiting", "delayed")`（每次入队多一次 Redis 往返，可接受）；
   - 已知取舍：并发入队可轻度超出（软上限），换取不做分布式事务/锁的简单性。

2. **调用方语义按重要度分级**：
   - 用户可重试的任务（agent-run、doc-process）：捕获 `QueueBackpressureError`，返回/推送"队列繁忙，请稍后重试"（文档标记 `failed` 并给可操作错误文案）；**不得**把背压当普通失败（500）处理；
   - 尽力而为的旁路（webhook-deliver、email-send）：入队失败记录 warn 并跳过，不阻断业务主流程（webhook 事件在背压窗口可能缺失，见"负面"）；
   - 其余位置沿用各自既有的 enqueue 错误处理。

3. **可观测性（就绪探针附加降级位）**：`/api/health/ready` 新增 `queueBackpressured`（任一队列积压 ≥ 上限即置位）与 `queue` 快照（每队列 depth/maxDepth）。与 `rateLimitDegraded` / `revocationDegraded` 同模式：**增量字段、不改变 200/503 聚合**（摘流量不会消费存量积压，只会加剧），供监控告警。管理端 `/admin/monitoring` 的队列快照继续提供深度明细。

4. **存量积压的处置**：仍以人工巡检 + Runbook（RB-03）为准——恢复 worker / Redis、按配额调整 `QUEUE_*_CONCURRENCY` 与内存。本决策只提供"阻止继续恶化"的入队防护，**不包含**自动降级消费、自动扩容或积压告警推送（列为后续演进）。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| 只做监控告警、不拒绝入队 | 无界积压仍会把进程推到 OOMKilled；且告警依赖外部监控系统接入，当前项目无强制推送通道 |
| 无界队列 + 请求侧限流（不动队列） | 限流按请求频率封顶，但任务耗时突增（如大文档、慢模型）时积压仍无界；两者互补而非替代 |
| 丢弃最旧积压换容量 | 破坏任务语义（文档处理不可丢）；且 DLQ 已承担失败隔离职责 |
| 全局限额（跨队列共享） | 快队列（文档处理）与慢队列（Agent）语义不同，全局配额会让慢任务挤占快任务；按队列独立封顶更简单可解释 |
| 同步背压（生产者阻塞等待） | 在 HTTP 请求路径上引入不可控等待；异步队列的既有语义是"快速入队"，拒绝比阻塞更优 |

## 后果

**正面**

- 积压有界，`OOMKilled` 的队列成因被消除（入队防护部分关闭 X5/X6）；
- 背压信号显式进入就绪探针，监控可告警；用户得到可重试的明确提示而非无限排队；
- 双后端一致的 `QueueBackpressureError` 契约，路由层无需区分底层实现。

**负面 / 约束**

- 背压窗口内 webhook 事件会**丢失**（记录 warn，不重放）——仅在高负载 >500 积压时发生，属可接受降级；
- BullMQ 每次入队多一次 `getJobCounts` 往返（~亚毫秒级，相对入队本身开销可忽略）；
- 存量积压无自动处置/主动告警推送，仍需运维按 RB-03 巡检（后续演进项）。

**回滚方式**

- 调高 `QUEUE_MAX_DEPTH`（或设为极大值）即等价关闭背压，无需改代码；完全回滚即撤销入队检查与探针字段。

## 相关 ADR

- [ADR-0002：后台任务队列](adr-0002-background-job-queue.md)
- [ADR-0006：读路径存储演进](adr-0006-read-path-storage-evolution.md)
