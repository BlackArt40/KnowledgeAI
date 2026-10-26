---
title: "ADR-0009：业务服务语言选型（Java 17 + Spring Boot 3）"
description: 阶段 4 拆出的业务服务选定 Java 17 + Spring Boot 3：对齐国内 Java 岗轨道；密码/JWT/列名逐字节兼容为硬约束；Flyway baseline 承接 Prisma 迁移；禁止内存 map 读事实源
type: explanation
category: architecture
level: L1
version: 1.0.0
authors:
  - tech-lead
owner: 技术负责人
reviewed_at: 2026-10-13
review_interval: 180
status: published
applies_to: ">=1.2.0"
related:
  - ../service-split.md
  - adr-0001-in-memory-store-write-through-db.md
  - adr-0003-multi-tenant-isolation.md
  - adr-0006-read-path-storage-evolution.md
  - adr-0008-ai-service-framework.md
---

# ADR-0009：业务服务语言选型（Java 17 + Spring Boot 3）

## 状态

已接受（accepted）

## 背景

[服务拆分实施手册](../service-split.md)阶段 4 将鉴权、租户、KB 元数据、会话、计费、限流、Webhook 从 Next 进程拆出为独立业务服务。手册要求语言选择「开工前写进 ADR」，并给出两个候选与一条红线（禁止内存 map 作读事实源）。

决策输入：

- **目标轨道**：本仓库阶段 4～6 走「生产 / Java 岗」轨道（手册两条实施轨道之二），简历需对齐国内 ToB / 多实例 / Java 后端岗位——用户已在架构讨论中确认业务服务采用 Java 17+ Spring Boot、前端保持 React（**注**：该前提已于 2026-10-16 变更——前端改为 Vue 3 绞杀重写并已收官，业务服务的语言决策不受影响，见 [service-split.md](../service-split.md)「前端替换」节）、AI 服务用 Python（ADR-0008）。
- **国内现实**：业务 CRUD 后端的事实标准是 Java + Spring Boot；Spring Boot 3.x 强制 Java 17+，新项目默认即「Java 17 + Spring Boot 3」。
- **兼容硬约束**：业务服务必须登录**同一批用户数据**——密码哈希与 API Key 哈希格式必须与现网 TS 实现逐字节兼容（见决策 3）。
- **单人维护预算**：三服务（TS 前端/BFF、Java 业务、Python AI）已是上限，不再引入第四种运行时。

## 决策

1. **语言与框架：Java 17 + Spring Boot 3.x**，组件选型：
   - Web/安全：Spring Security 6（JWT 资源服务器模式）+ Spring Validation；
   - JWT：**nimbus-jose-jwt**（Spring Security 自带依赖，HS256 与现网 `jose` 签发的 `kai-token` 逐字节兼容——同一 `AUTH_SECRET`、同一算法、同一 header/payload 结构）；
   - 数据访问：Spring Data JDBC（或 JdbcTemplate）——不用 JPA/Hibernate：现网 Prisma 已管理 schema，业务服务只做读为主 + 少量写，避免第二套 ORM 元模型；
   - 迁移：**Flyway**，对现有 17 个 Prisma 迁移 `baseline` 后，新迁移仅由 Flyway 产出（Prisma 退出迁移管理，保留 `schema.prisma` 作为模型文档直至下线）；
   - 限流：Redis 滑动窗口（与现网 `src/proxy.ts` 同算法同维度）或 Bucket4j，二选一在 4.6 实施时定；
   - 队列交互：业务服务只投递（Redis/BullMQ 语义不变），消费仍归 TS worker 与 Python worker。

2. **模块边界（对应手册 4.1～4.10）**：`services/business/` 单模块 Gradle? 否——**Maven 单模块**（国内主流、CI 零额外配置），包结构按领域划分 `auth/ tenant/ kb/ chat/ billing/ ratelimit/ ai/`。

3. **数据兼容契约（硬约束，纳入 4.1 验收）**：
   - 密码：`pbkdf2$<iterations>$<b64url(salt)>$<b64url(hash)>`，PBKDF2-HMAC-SHA256（现网默认 100000 迭代）——Java 侧 `SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")` 逐字节对齐；
   - API Key：SHA-256 hex（`token-hash.ts`）+ `kai_sk_` 前缀校验；
   - 用户表列名/语义以 Prisma migration 生成物为准，Flyway baseline 不得改写历史表结构。

4. **红线（手册原文）**：业务服务**禁止**再用内存 map 作读事实源；PostgreSQL 是唯一业务读路径，Redis 仅作限流/缓存/撤销，不作权限唯一来源。

5. **AI 服务交互**：业务服务持有 `AI_INTERNAL_TOKEN`，SSE 透传职责从 Next BFF 迁移至业务服务（4.8）；`/internal/*` 契约与 ADR-0008 不变。

## 备选方案

| 方案 | 被否原因 |
|------|----------|
| Go + 标准库/chi | 与现有 TS 心智接近、单二进制运维简单；但与「生产 / Java 岗」轨道目标错位，Spring Security 级别的安全生态（OAuth/2FA/会话）需大量自建，国内业务 CRUD 岗位匹配度低 |
| Node + NestJS（不拆语言） | 与现有 TS 同语言心智最平；但拆分的核心价值之一（对齐 Java 岗、证明跨栈能力）落空，且 NestJS 生态对 2FA/OAuth/限流的现成度并不优于 Spring |
| 维持 TS 单体不拆 | 简历轨道（阶段 0～3）已交付；生产轨道的多实例、DB 读事实源、Java 岗目标无法达成——非候选 |
| Kotlin + Spring Boot | 语言层面优于 Java，但国内 ToB 招聘与简历关键词匹配度低于 Java，且叠加「新语言 + 新框架」双学习成本 |

## 后果

**正面**

- 直接对齐手册阶段 4～6 的验收标准与目标岗位；
- Spring Security 6 的 JWT 资源服务器 + 现成过滤器链覆盖 4.1/4.6 大部分需求；
- Flyway baseline 承接 17 个 Prisma 迁移，迁移治理从「双工具」收敛为「单工具」；
- 与 Python AI 服务（ADR-0008）、TS 前端形成手册规划的国内三层形态。

**负面 / 约束**

- 运维从两个运行时变三个（JVM 内存/启动/镜像体积显著大于 Node 与 Python 服务）；
- 密码/JWT/列名兼容的逐字节对齐是隐性地雷：任何 Prisma 列名 camelCase 与 Java 驼峰映射不一致都会在切换窗口爆炸——4.9 的影子读流量是必须步骤；
- 跨语言契约测试面扩大：`ai-contract`（Python）之外，业务服务的兼容性测试（同一份用户数据 Java 能登录、同一 JWT 两端可验）需新增 CI 步骤；
- 单人串行：阶段 4 预估 4～12 周，必须按里程碑推进（M0 骨架 → M1 身份/RBAC → M2 KB/会话/计费 → M3 限流/切换窗口）。

**回滚方式**

- 4.10（下线 Next API）之前，业务服务为旁路：停掉即回到 Next 单体读路径（开关/反代切回）；
- Flyway baseline 只增不改历史，回滚 = 停用业务服务 + Prisma 侧继续管理；
- 数据层无破坏性动作（阶段 4 不删表不删列，仅读路径切换）。

## 相关 ADR

- [ADR-0001：内存存储 + 写穿 DB](adr-0001-in-memory-store-write-through-db.md)（本 ADR 的 4.7 即终结其生产读路径）
- [ADR-0003：多租户隔离契约](adr-0003-multi-tenant-isolation.md)（`canViewKb` 签名「workspace 必填」在 Java 侧保持）
- [ADR-0006：读路径存储演进](adr-0006-read-path-storage-evolution.md)（`revocationDegraded` 语义由业务服务继承）
- [ADR-0008：AI 服务框架选型](adr-0008-ai-service-framework.md)（`/internal/*` 契约不变）
- [服务拆分实施手册](../service-split.md)
