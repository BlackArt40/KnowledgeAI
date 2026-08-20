---
title: "ADR-0001：内存存储 + 写穿数据库"
description: 决策以内存 Store 为读路径事实源、Prisma 写穿持久化，分析备选方案与多实例约束
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
related: [../overview.md]
---

# ADR-0001：内存存储 + 写穿数据库

## 状态

已接受（accepted）

## 背景

早期版本（TD-01）所有领域数据挂在 `globalThis` 内存对象（`__KAI_*_STORE__`），重启即失、无法多实例。生产化要求数据持久化，但不能牺牲读路径性能与「纯内存演示模式」的零配置体验。

约束条件：

- 保留无 `DATABASE_URL` 时的完整演示模式（内存运行，重启重置）；
- 读请求需要极低延迟（前端会话、KB 列表等高频读取）；
- 写入不能阻塞请求线程；
- 现有 11 个领域 store（auth / kb / chat / billing / agent / apikeys / models / notifications / security / team / admin）结构稳定，不希望大规模重写。

## 决策

采用**内存存储为读路径事实源 + 写穿（write-through）异步持久化到 PostgreSQL**：

1. **读**：一律走内存 Store（Map 查找，< 1ms）；
2. **水合（hydrate）**：首个 API 请求时把 DB 行懒加载进内存（`src/lib/db/hydrate.ts`，一次性）；
3. **写穿（persist）**：每次变更先更新内存，再异步写穿 DB（`src/lib/db/persist.ts`，失败仅记录日志、不抛出，不阻塞请求）；
4. **统一仓储**：`src/lib/db/repository.ts` 封装 Prisma CRUD，各 store 通过仓储访问 DB；
5. **健康检查**：仓储层提供 `checkDbHealth()`，接入就绪探针。

**新增持久化实体的改动契约（4 处同步）**：`store.ts`（内存形态）→ `persist.ts`（写穿函数）→ `hydrate.ts`（加载函数）→ `prisma/schema.prisma`（+ 新迁移）。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| 直接以 DB 为读路径 | 高频读场景延迟高（网络往返 + ORM 开销）；演示模式无法实现 |
| Redis 缓存 + DB | 引入强依赖；`Redis 未配置时`仍要兜底；复杂度与收益不成比例 |
| 内存 store 直接同步写 DB | 写路径阻塞请求线程；批量变更场景放大延迟 |

## 后果

**正面**

- 读路径零 DB 往返，前端体验保持内存级延迟；
- 无 DB 时演示模式原样可用，Provider 门控（`DATABASE_URL` 未设置 → client 返回 null）；
- 写路径异步化，请求线程不被持久化拖慢。

**负面 / 约束**

- 内存与 DB 存在**最终一致窗口**（写穿是异步的，崩溃可能丢失未落库变更）；
- 多实例部署时读仍落在各自实例内存（**不共享**），仅写穿保证落库 —— 面向多实例强一致读的场景（如负载均衡部署）需要演进（见回滚方式）；
- 内存占用随数据量线性增长，需关注大租户场景。

**回滚方式**

- 关闭写穿：删除 `hydrate` / `persist` 接入即可回到纯内存演示模式；
- 演进路径：当需要多实例共享读时，将内存 Store 替换为 Redis 或引入分布式缓存层（保持 store 接口不变，替换实现）。

## 相关 ADR

- [ADR-0002：后台任务队列](adr-0002-background-job-queue.md)
