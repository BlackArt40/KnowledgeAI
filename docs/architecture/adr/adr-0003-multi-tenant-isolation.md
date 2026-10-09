---
title: "ADR-0003：多租户隔离契约"
description: 租户边界以 Workspace 为准：KB 归属落库、权限函数必填租户参数、公开资源的可见性语义为"同租户可读"
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
related: [../overview.md, adr-0001-in-memory-store-write-through-db.md, adr-0006-read-path-storage-evolution.md]
---

# ADR-0003：多租户隔离契约

## 状态

已接受（accepted）

## 背景

KnowledgeAI 是多租户 SaaS：`Workspace`（工作区）是租户边界，知识库、文档、会话、Agent 任务、Webhook 等资源都归属于某个工作区。2026-09 的工程保障审计发现三处边界漏洞并已整改：

- 跨租户读：单文档路由漏传 `workspaceId`，隔离校验可被绕过（S2）；
- 租户归属不持久：`KnowledgeBase.workspaceId` 仅在内存，重启/部署后被归并回 `ws_default`（S3）；
- 自助注册用户落入默认租户，可读默认组织的演示知识库（S5）。

整改后（`fix/engineering-assurance-p0-p1`，PR #27）需要一个**正式契约**回答：租户边界的判定规则是什么、权限函数如何防止漏传、"公开（public）"资源的可见性范围到底多大。特别是审计发现过一个需要产品语义确认的设计点：**公开 KB 是否应支持跨租户只读？**——当时实现取"同租户内可读"，但未写成正式决策。

## 决策

1. **租户边界 = Workspace**。所有资源（KB / 文档 / 会话 / 任务 / Webhook / Bot）创建时记录 `workspaceId`；判定"谁能访问"时，调用者工作区与资源工作区**必须**同为校验输入。

2. **隔离校验函数参数必填**。`canViewKb / canEditKb / canViewDoc / canEditDoc` 的 workspace 参数为**必填**（漏传即编译失败）；全仓 30+ 调用点显式传参。路由层不得旁路这些函数自建判断。

3. **租户归属持久化**。`KnowledgeBase.workspaceId` 落库（迁移 `20260930120000_tenant_persistence`，含 `Workspace.members`）；`persist.ts` / `hydrate.ts` 读写真实列，重启/部署不再归并 `ws_default`。历史数据由迁移的 `DEFAULT 'ws_default'` 回填（与旧行为一致，不新增串租）。

4. **自助注册用户的归属**：新注册用户落在**个人工作区**（personal workspace），不加入默认组织；演示种子数据与真实租户分离。

5. **公开资源的可见性语义：同租户内可读（same-tenant readable）**。`visibility: "public"` 的 KB（及文档分享）表示**同一工作区内**所有成员可读，**不支持跨租户公开只读**；`graph/route.ts` 等路由对 workspace 的硬校验（`kb.workspaceId !== u.workspaceId → 403`）是该语义的**预期实现**，不是误伤。
   - 明确排除：未登录匿名访问、跨租户访问、分享链接跨租户访问均不在本决策范围内（当前不支持）。
   - 若未来需要"跨租户公开只读"（如对外发布知识库），必须先修订本 ADR，再动实现；`graph` / `knowledge-base` 等路由的硬校验是守门点，**禁止**以修 bug 为名弱化。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| 公开 = 跨租户匿名只读 | 扩大数据暴露面（任意租户的"公开"内容全网可达），需要独立的内容发布/审核能力，超出当前产品形态；且会让现有路由的租户硬校验全部需要重审 |
| 公开 = 跨租户认证只读 | 同上，且跨租户枚举/遍历风险需要额外的可见性发现（discovery）控制，成本高于收益 |
| 去掉 workspaceId 必填、保留可选默认值 | 审计 S2 的根因正是"漏传即静默降级"——必填化是防止回归的关键，不可回退 |
| KB 归属继续只存内存 | S3 已证明重启即归并、串租；持久化是边界可信的前提 |

## 后果

**正面**

- 租户边界有单一、可测试的判定入口（必填参数的权限函数）；
- 公开资源的语义明确且与全仓实现一致，消除"公开 KB 403 是不是 bug"的歧义；
- 历史数据与旧行为兼容（默认值回填），无迁移期串租。

**负面 / 约束**

- "公开"当前不具备对外发布能力；若有多租户内容分发需求，须立新 ADR + 新实现（不能绕过路由硬校验）；
- 必填参数提升了新路由的开发成本（这是有意的防回归代价）。

**回滚方式**

回滚到"可选参数"即重新打开 S2 类漏洞，**不接受**回滚；语义变更（跨租户公开）只能通过新 ADR 演进。

## 相关 ADR

- [ADR-0001：内存存储 + 写穿数据库](adr-0001-in-memory-store-write-through-db.md)
- [ADR-0006：读路径存储演进](adr-0006-read-path-storage-evolution.md)
