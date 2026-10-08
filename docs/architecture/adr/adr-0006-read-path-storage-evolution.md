---
title: "ADR-0006：读路径存储演进（鉴权态共享化）"
description: 业务读路径维持内存 + 写穿（ADR-0001），鉴权关键读路径（apiKey 校验、JWT jti 撤销）演进为内存快路径 + DB/Redis 回源，解除多副本部署的鉴权一致性约束
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
related: [../overview.md, adr-0001-in-memory-store-write-through-db.md, adr-0003-multi-tenant-isolation.md, adr-0007-queue-backpressure.md]
---

# ADR-0006：读路径存储演进（鉴权态共享化）

## 状态

已接受（accepted）

## 背景

[ADR-0001](adr-0001-in-memory-store-write-through-db.md) 确立了"内存为读路径事实源 + 写穿 DB"的模型。它对业务读非常高效，但带来一个部署约束：**多实例下每个实例的内存互不可见**，写穿产生的最终一致窗口在单实例内不可观测、在多实例间会放大为正确性缺陷。

2026-09 审计的 S4/F5 把问题收缩到最危险的一个子集——**鉴权读路径**：

- **apiKey 校验**（`validateApiKey`）：只扫本进程内存。实例 A 创建的 key，实例 B 一律 401（直到 B 重启触发 boot hydration）；
- **JWT jti 撤销黑名单**（`revokeJti` / `isJtiRevoked`）：globalThis Map。实例 A 撤销的会话，实例 B 仍放行——**这是安全缺陷**（被盗 token 在未撤销的实例上继续可用），且进程重启即丢失全部撤销记录。

审计给出的过渡方案是 `replicas: 1` 单实例（连同 k8s 清单的 X1 前置条件）。本 ADR 记录**正式演进决策与实现**：只把鉴权关键项从"纯内存"升级为"内存快路径 + 共享回源"，业务读路径维持 ADR-0001 不变。

## 决策

1. **apiKey 校验 = 内存快路径 + 节流 DB 回源**（`validateApiKeyShared`）：
   - 命中内存 → 直接返回（常态零开销）；
   - 未命中 → 以 ≤1 次/3 秒 的节流从 DB 扫回未水合的行（合并进内存后复查）。节流 + 单飞（in-flight 合并）防止垃圾 bearer token 把未命中路径变成 DB 放大攻击；**新建 key 在其它实例最迟 ~3 秒可见**；
   - 代理层（`proxy.ts` 限流分级）**有意保留**同步版 `validateApiKey`（纯内存、best-effort）——分级错误只影响限流桶选择，不构成授权，避免热路径加 DB 往返。
   - 授权路径（`requireApiKeyScope` 等）必须使用 `validateApiKeyShared`。

2. **JWT jti 黑名单 = 本地 Map + 共享 Redis 镜像**（`src/lib/auth/jti-shared.ts`）：
   - `revokeJti()` 同步写本地 Map + 异步 `SETEX jti-blacklist:<jti> EX 8d`（8 天 > 7 天 token 生命周期）；
   - `verifyToken()` 先查本地 Map，未命中再查 Redis；命中后**回填本地**（避免 Redis 抖动导致同一实例反复穿透）；
   - 无 `REDIS_URL`（演示/单实例）：本地 Map 为唯一事实源，行为同旧版；
   - Redis 不可达：回落到本地 Map（**同实例撤销仍强制**；跨实例撤销在故障窗口内失效），降级计数并在 `/api/health/ready` 暴露 `revocationDegraded`（与限流的 `rateLimitDegraded` 同模式，F9）。

3. **范围边界**：本决策只覆盖鉴权/撤销两类读路径（审计 X1 前置条件 ① 的指名范围）。其余业务读路径（KB、文档、会话等）**继续维持内存 + 写穿模型**；多副本部署仍受其它约束（uploads 卷共享、见 k8s 清单前置条件 ②）。

4. **多副本要求**：启用多副本时必须配置 `REDIS_URL`（jti 共享、限流、队列均依赖）；就绪探针的降级位（`revocationDegraded` / `rateLimitDegraded`）纳入监控告警。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| 全部读路径迁 DB（彻底放弃内存模型） | 推翻 ADR-0001 的定位（读 <1ms、写零阻塞），波及全部 store，风险与工期不成比例；鉴权项已覆盖最危险子集 |
| apiKey 增加明文 hash 列做 O(1) 查库 | 需要迁移 + 存量密文回填（必须应用侧逐行解密重算），改动面大于本轮收益；节流扫回在当前 key 规模下负载有界。若 key 数量级增长，可演进为该方案（届时修订本 ADR） |
| jti 撤销改存 DB 表 | 每次未命中请求都要查库（Redis GET 亚毫秒级更合适）；且撤销是高频短生命周期数据，DB 只增负担 |
| jti 缓存"未撤销"负结果 | 需要短 TTL 负缓存 + 失效协议，复杂度高；当前"未命中即查 Redis"的读放大与限流 EVAL 同量级，可接受 |
| 维持 `replicas: 1` 不做改造 | 审计判定为"扩容即回归"，且重启丢撤销是既有安全缺陷；单实例约束迟早阻断水平扩展 |

## 后果

**正面**

- 多副本下**鉴权与撤销跨实例一致**（apiKey 最迟 ~3s 可见；撤销即时生效——查询命中 Redis）；
- 单实例/演示模式零变化（无 Redis 时一切照旧），无破坏性迁移；
- 降级可见：Redis 故障时的安全降级（跨实例撤销失效）由 `revocationDegraded` 显式暴露，可告警。

**负面 / 约束**

- 新增一个 Redis 常驻依赖（仅多副本/启用 Redis 时）；Redis 故障窗口内跨实例撤销失效（本地撤销不受影响）——以告警 + 快速恢复补偿；
- apiKey 新建 ~3s 跨实例可见延迟（节流换取防放大），单实例无影响；
- 其余业务读路径仍为单实例内存模型，多副本完整可行性还取决于 uploads 卷方案（对象存储/RWX）。

**回滚方式**

- 关闭共享层：不配置 `REDIS_URL` 即回到"本地 Map + 内存校验"（撤销退回单实例语义，`revocationDegraded` 会体现降级与否——此时视作配置降级而非故障）；
- 代码层回滚即撤销本 ADR 的两处改造，无 schema 迁移、无数据变更。

## 相关 ADR

- [ADR-0001：内存存储 + 写穿数据库](adr-0001-in-memory-store-write-through-db.md)
- [ADR-0002：后台任务队列](adr-0002-background-job-queue.md)
- [ADR-0007：队列背压](adr-0007-queue-backpressure.md)
