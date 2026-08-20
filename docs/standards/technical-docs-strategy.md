---
title: KnowledgeAI 技术文档体系方案
description: KnowledgeAI 技术文档体系设计与落地指南：分类结构、编写规范、生命周期、工具平台与分阶段实施
type: explanation
category: standards
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: draft
applies_to: ">=1.2.0"
related: [standards/README.md, index.md]
---

# KnowledgeAI 技术文档体系方案

> **文档定位**：面向 KnowledgeAI 团队的技术文档体系设计与落地指南。基于项目现有文档资产盘点，规划文档分类结构、编写规范、生命周期管理、工具平台选型与分阶段实施路径。
>
> **文档版本**：v1.0　**状态**：草案（待评审）　**更新日期**：2026-08-20
>
> **维护责任人**：技术文档负责人（Technical Writer）　**评审人**：技术负责人 / 各模块 Owner

---

## 摘要

KnowledgeAI 已具备完整的产品能力与高质量工程实践（CI 四门禁、覆盖率门槛、蓝绿部署），但**文档资产与工程水平严重不匹配**：核心文档以「产品文档 / 设计说明 / 路线图」为主，缺失 API 参考、部署运维手册、故障排查、开发规范与架构说明；文档无统一元数据、无版本管理、无评审流程、无质量度量。

本方案以 **docs-as-code**（文档即代码）为核心理念，规划：

1. **六大文档类别**（入门 / 架构 / API / 规范 / 运维 / FAQ）及对应目标、读者、责任人；
2. **统一编写规范**（元数据、命名、代码示例、术语、检索）；
3. **全生命周期管理**（创建 → 评审 → 发布 → 更新 → 归档，与代码变更同步）；
4. **工具平台选型**（VitePress + GitHub + CI 自动化的推荐组合）；
5. **四阶段落地路径**与**量化质量指标**（覆盖率 / 使用频次 / 满意度 / 时效性 / 完整性）。

预期收益：新成员上手时间从「翻代码 + 问人」缩短至 1 天内；API 使用问题工单下降 30%+；文档与代码零漂移。

---

## 一、现状盘点与差距分析

### 1.1 现有文档资产清单

| 文档 | 位置 | 类型 | 规模 | 更新日期 | 问题 |
|------|------|------|------|----------|------|
| README.md | 仓库根 | 项目主页 | 中 | 较新 | 信息过载；「项目结构」重复出现两次；无维护责任人 |
| AGENTS.md | 仓库根 | AI 会话指南 | 中 | 持续 | 质量高，但面向 AI 编辑会话，非人类读者 |
| 产品文档.md | docs/ | 产品规划 | 27KB | 2026-08-10 | 偏向规划与页面清单，非用户手册 |
| 设计说明.md | docs/ | UI 设计体系 | 115KB | 2026-08-14 | 体量过大（单文件），检索困难 |
| 项目结构.md | docs/ | 代码导览 | 10KB | 2026-08-10 | 与代码易漂移，无自动校验 |
| ROADMAP.md | docs/ | 路线图 | 88KB | 2026-08-13 | 已完成态堆积，历史信息与现状混淆 |
| docs/superpowers/ | docs/ | 计划/规格 | 少量 | — | 无统一管理 |
| sdk/go、sdk/javascript、sdk/python | sdk/ | SDK 源码 | — | — | **无 README、无使用文档** |
| integrations/ | integrations/ | 扩展/集成源码 | — | — | **无 README、无安装指南** |

### 1.2 差距分析（Gap Analysis）

对照 Divio 文档系统四象限（教程 Tutorial / 指南 How-to / 参考 Reference / 解释 Explanation）逐项核查：

| 文档类别 | 现状 | 差距 | 优先级 |
|----------|------|------|--------|
| 入门指南（教程） | README 快速开始仅覆盖本地开发 | 无新成员 onboarding 手册、无贡献指南（CONTRIBUTING.md） | 🔴 高 |
| 架构设计（解释） | AGENTS.md 零散覆盖架构要点 | 无统一架构说明文档、无架构决策记录（ADR） | 🔴 高 |
| API 参考 | `/docs` Swagger UI 存在，但无文档化配套 | 无 API 使用指南、无错误码/限流/鉴权说明的叙事文档 | 🔴 高 |
| 开发规范 | lint/CI 有硬约束，但无成文规范 | 无编码规范、Git 提交规范、代码评审规范、测试编写规范 | 🟠 中 |
| 部署运维（指南） | README 有 Docker 快速开始 | 无完整部署手册（Staging/生产蓝绿）、无环境变量全表、无监控告警说明 | 🟠 中 |
| FAQ 与故障排查 | 无 | **完全缺失** | 🟡 中 |
| 变更记录 | 无 CHANGELOG | 版本演进无追溯 | 🟡 低（近期补齐） |

### 1.3 核心问题诊断（根因）

1. **无元数据与责任机制**：文档无 owner、无评审日期、无状态字段 → 无法触发维护，必然过期。
2. **无结构与导航**：docs/ 平铺混放，中文名/英文名混用（`产品文档.md` vs `ROADMAP.md`），无索引页。
3. **文档与代码不同步**：无 CI 门禁校验文档引用、无「文档随 PR 变更」约束。
4. **无质量度量**：没有覆盖率/新鲜度/使用数据，无法驱动改进。
5. **「写文档」未进入工作流**：无模板、无评审清单，贡献门槛高。

---

## 二、文档分类与结构

### 2.1 分类原则：Divio 文档系统 + 项目扩展

四象限是分类骨架，每篇文档必须明确自己的象限，**一篇文档只服务一个目的**：

| 象限 | 目的 | 语气 | 典型读者 | 反例 |
|------|------|------|----------|------|
| **教程 Tutorial** | 学习（step-by-step） | 引导式，带成果 | 新成员、初级开发者 | 「本教程同时讲解配置…」 |
| **指南 How-to** | 完成任务 | 指令式，聚焦单任务 | 所有开发者 | 把安装、配置、使用写成一堵墙 |
| **参考 Reference** | 查询信息 | 客观陈述 | 所有开发者 | 在参考里写教程 |
| **解释 Explanation** | 理解原理 | 概念叙事 | 架构师、高级开发者 | 在解释里贴代码清单 |

在此基础上按 KnowledgeAI 业务扩展为 **六大文档类别**，见 2.2。

### 2.2 六大文档类别设计

#### 类别一：入门指南（Getting Started）

| 项 | 内容 |
|----|------|
| **编写目标** | 新成员在 1 天内完成环境搭建、跑通「上传文档 → 问答 → Agent 调研」主流程 |
| **适用读者** | 新入职开发者、实习生、外部贡献者 |
| **维护责任人** | 技术文档负责人（内容）+ 各模块 Owner（技术准确性） |
| **文档清单** | `quickstart.md`（5 分钟起步）、`onboarding.md`（环境搭建+开发工具链）、`contribution-guide.md`（贡献流程）、`demo-accounts.md`（演示账号与数据） |
| **存放位置** | `docs/getting-started/` |
| **质量要求** | 每篇教程必须**在干净环境实测通过**，标注总耗时 |

#### 类别二：架构设计文档（Architecture & ADR）

| 项 | 内容 |
|----|------|
| **编写目标** | 解释系统「为什么这样设计」，沉淀架构决策，防止「架构漂移」 |
| **适用读者** | 架构师、中高级开发者、新成员（进阶阅读） |
| **维护责任人** | 技术负责人（总体架构）；各模块 Owner（模块架构与 ADR） |
| **文档清单** | `architecture-overview.md`（总体架构：内存存储+写穿 DB、队列、SSE 链路）、`rag-engine.md`、`agent-orchestration.md`、`auth-rbac.md`、`billing.md`、`queue.md`、`deployment-architecture.md`、`adr/`（架构决策记录，见附录 A.2） |
| **存放位置** | `docs/architecture/` |
| **质量要求** | 每篇配 Mermaid 图；每个重大决策必须有 ADR |

#### 类别三：API 参考（API Reference & Guides）

| 项 | 内容 |
|----|------|
| **编写目标** | 让外部开发者无需读源码即可完成鉴权、调用、调试、处理错误 |
| **适用读者** | 外部开发者、SDK 使用者、集成方 |
| **维护责任人** | API 负责人 + 技术文档负责人（叙事文档）；SDK Owner（SDK 文档） |
| **文档清单** | `api-guide.md`（鉴权/限流/分页/错误处理/Webhook 叙事指南）、`api-reference.md`（由 OpenAPI 自动生成）、`sdk/javascript.md`、`sdk/python.md`、`sdk/go.md`、`webhook.md`、`errors.md`（错误码全表） |
| **存放位置** | `docs/api/` |
| **质量要求** | **参考由 OpenAPI 规范生成，禁止手写**；每个端点 ≥1 个可运行示例；错误码 100% 覆盖 |

#### 类别四：开发规范（Development Standards）

| 项 | 内容 |
|----|------|
| **编写目标** | 将 CI 硬约束 + 团队约定沉淀为成文规范，新代码「一次写对」 |
| **适用读者** | 全体开发成员 |
| **维护责任人** | 技术负责人（制定）+ 全员（遵守） |
| **文档清单** | `coding-standards.md`（TS/React/样式约定）、`git-workflow.md`（分支/提交信息/PR 模板）、`testing-standards.md`（单测/集成/E2E 编写要求与覆盖率门槛）、`code-review.md`（评审清单）、`db-migration.md`（schema 变更流程） |
| **存放位置** | `docs/standards/` |
| **质量要求** | 规范条目必须可验证（对应 lint 规则或 CI 检查）；与 AGENTS.md 互相引用 |

#### 类别五：部署运维手册（Ops & Deployment）

| 项 | 内容 |
|----|------|
| **编写目标** | 运维人员可独立完成环境准备、部署、回滚、监控与故障处理 |
| **适用读者** | 运维工程师、部署责任人、SRE |
| **维护责任人** | DevOps/部署负责人 |
| **文档清单** | `deployment-guide.md`（Docker/K8s/蓝绿部署全流程）、`env-vars.md`（环境变量全表：必填/可选/默认值/演示回退）、`monitoring.md`（健康检查探针/SLI 指标/告警）、`backup-recovery.md`、`security-checklist.md`、`upgrade-guide.md`（版本升级步骤） |
| **存放位置** | `docs/ops/` |
| **质量要求** | 每步命令在干净环境实测；回滚步骤与部署步骤同等详细 |

#### 类别六：FAQ 与故障排查（FAQ & Troubleshooting）

| 项 | 内容 |
|----|------|
| **编写目标** | 沉淀高频问题与已知坑位，缩短排障时间，降低重复提问 |
| **适用读者** | 全员、外部用户（公开子集） |
| **维护责任人** | 技术文档负责人（汇编）+ 各模块 Owner（技术正确性） |
| **文档清单** | `faq.md`（按模块分类）、`troubleshooting/`（`common-errors.md`、`rag-issues.md`、`deployment-issues.md`、`database-issues.md`） |
| **存放位置** | `docs/faq/` |
| **质量要求** | 每条包含「症状 → 原因 → 解决步骤 → 预防」四段式；从工单/群聊高频问题反向沉淀 |

### 2.3 目录结构与导航设计

推荐的 `docs/` 标准结构（与现有文档平滑迁移）：

```
docs/
├── index.md                  # 文档门户首页（导航中枢）
├── getting-started/          # ① 入门指南
│   ├── quickstart.md
│   ├── onboarding.md
│   ├── contribution-guide.md
│   └── demo-accounts.md
├── architecture/             # ② 架构设计
│   ├── overview.md
│   ├── rag-engine.md
│   ├── agent-orchestration.md
│   ├── auth-rbac.md
│   ├── queue.md
│   ├── adr/                  # 架构决策记录（ADR-0001.md ...）
├── api/                      # ③ API 参考
│   ├── guide.md              # 手写叙事指南
│   ├── reference.md          # 由 OpenAPI 自动生成
│   ├── sdk-javascript.md
│   ├── sdk-python.md
│   ├── sdk-go.md
│   ├── webhooks.md
│   └── errors.md
├── standards/                # ④ 开发规范
│   ├── coding-standards.md
│   ├── git-workflow.md
│   ├── testing-standards.md
│   ├── code-review.md
│   └── db-migration.md
├── ops/                      # ⑤ 部署运维
│   ├── deployment-guide.md
│   ├── env-vars.md
│   ├── monitoring.md
│   ├── backup-recovery.md
│   └── upgrade-guide.md
├── faq/                      # ⑥ FAQ 与故障排查
│   ├── faq.md
│   └── troubleshooting/
├── changelog/                # 变更记录
│   └── CHANGELOG.md
└── assets/                   # 图片等资源（每文档子目录）
```

**迁移策略**：`产品文档.md` → 拆分为 `getting-started/`（用户视角）+ `docs/index.md`（产品概述）；`设计说明.md` → 拆分为 `architecture/`（技术相关）+ 保留设计稿；`项目结构.md` → 并入 `getting-started/onboarding.md` 或 `architecture/overview.md`；`ROADMAP.md` → 历史归档，迁移 `docs/archive/`。

### 2.4 文档分级（L0–L3）

| 级别 | 含义 | 示例 | 质量门槛 |
|------|------|------|----------|
| **L0** | 团队内部草稿 | 会议纪要、调研草稿 | 无门槛，不入正式目录 |
| **L1** | 项目内部文档 | 开发规范、架构说明 | 通过评审；CI 校验元数据 |
| **L2** | 对外发布文档 | 快速开始、API 指南 | L1 门槛 + 语言审校 + 示例实测 |
| **L3** | 产品关键文档 | 安全合规、升级指南 | L2 门槛 + 双人评审 + 定期复审 |

---

## 三、编写规范

### 3.1 元数据规范（Frontmatter）

**每篇文档强制使用 YAML Frontmatter**，CI 校验必填字段：

```yaml
---
title: 文档标题
description: 一句话描述（用于检索与 SEO）
type: tutorial | how-to | reference | explanation
category: getting-started | architecture | api | standards | ops | faq
level: L1 | L2 | L3
version: 1.0.0
authors: [zhang-san, li-si]          # 编写者
owner: 模块或文档负责人               # 维护责任人（必填）
reviewed_at: 2026-08-20              # 最近评审日期
review_interval: 180                 # 评审周期（天），默认 180
status: draft | review | published | archived | deprecated
related: [链接到相关文档]
applies_to: ">=1.2.0"                # 适用的软件版本
---

<!-- 正文从 H1 标题开始，Frontmatter 内不写正文 -->
```

**时效性规则**：`reviewed_at` 超过 `review_interval` 的文档，在门户标注 ⚠️ 待复审；超过 2 个周期自动降级为 `deprecated`。

### 3.2 命名规范

| 对象 | 规范 | 示例 |
|------|------|------|
| 目录名 | 英文 kebab-case | `getting-started/`、`architecture/` |
| 文件名 | 英文 kebab-case（新文档）；现有中文名文档随迁移逐步改 | `rag-engine.md` |
| 标题 | 文档内 H1，中文自然语言，不用文件名代替 | `RAG 引擎架构说明` |
| 图片 | 描述性命名 + 所属文档目录 | `assets/rag-flow.png` |
| 链接 | 相对路径，禁止绝对路径 | `../architecture/overview.md` |

> **迁移说明**：存量中文文件名（`产品文档.md` 等）保留短期可用，在第二阶段迁移时统一重命名并建立重定向，避免死链。

### 3.3 代码示例风格

1. **必须标注语言**：所有代码块写语言标识（`typescript`、`bash`、`yaml`…）。
2. **必须可运行**：L2 及以上文档的示例代码，须在干净环境实测；关键示例纳入 CI 冒烟（可参考现有 `scripts/smoke/` 模式）。
3. **占位符约定**：用 `<>` 包裹必填项、`[]` 包裹可选项，并在示例后注明取值来源：
   ```bash
   curl -X POST http://localhost:3000/api/v1/knowledge-bases \
     -H "Authorization: Bearer <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name": "我的知识库"}'
   ```
4. **输出示例**：预期输出用注释或独立块标注，标注「预期输出」。
5. **路径规范**：涉及项目路径统一从仓库根 `KnowledgeAI/` 表述。
6. **环境变量**：涉及敏感值一律用占位符，禁止真实密钥。

### 3.4 术语与语言标准

- **写作语气**：第二人称（「你」）、现在时、主动语态。❌「依赖包应被安装」 ✅「安装依赖包」。
- **术语一致性**：维护 `docs/standards/glossary.md` 术语表（见附录 C），首次出现的术语链接到术语表。例如统一用「知识库（KB）」「RAG 检索」「智能体（Agent）」，不混用「知识库/资料库」「机器人/Bot」。
- **中英混用规则**：专有名词与技术术语保留英文（RAG、SSE、RBAC、OpenAPI）；正文用中文；代码注释与提交信息用英文。
- **标题层级**：H1 每篇仅一个；层级不跳级（H1→H2→H3）；标题用名词短语。
- **文档长度**：单篇参考文档尽量 < 500 行；超长拆分子页（如 `设计说明.md` 115KB 必须拆分）。
- **AI 生成内容标记**：由 AI 辅助生成的文档需标注「AI 辅助编写，已人工校核」，保证准确性责任在人。

### 3.5 检索与 SEO

- 每篇文档的 `description` 必须包含 2–3 个核心检索词（如「KnowledgeAI RAG 部署 PostgreSQL」）。
- 门户首页 `docs/index.md` 提供分类索引 + 关键词速查表。
- 统一标签体系：`部署` `鉴权` `故障排查` `RAG` `API` `SDK` 等，用于站内搜索。
- 对外公开文档页配置站点搜索（见第五章 VitePress 方案）。

---

## 四、生命周期管理

### 4.1 文档生命周期流程

```
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ ① 创建  │ → │ ② 评审  │ → │ ③ 发布  │ → │ ④ 更新  │ → │ ⑤ 归档  │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
   新建/修改     技术+语言评审   合并发布     随代码变更     过期/废弃
   (PR)         (PR review)    (CI 校验)   (同步更新)     (archive/)
```

| 阶段 | 触发条件 | 动作 | 产出/门禁 |
|------|----------|------|-----------|
| **① 创建** | 新功能 PR / 新文档需求 / 模板创建 | 使用附录 A.1 模板起草；标注 Frontmatter `status: draft` | 草稿文档 |
| **② 评审** | 草稿完成 | 技术负责人（准确性）+ 文档负责人（规范与语气）评审；L2+ 增加语言审校 | 评审通过，`status: review → published` |
| **③ 发布** | 评审通过 | 合入主分支，CI 校验 Frontmatter 完整性与链接有效性；站点自动构建 | 文档上线；`reviewed_at` 记录 |
| **④ 更新** | 代码变更 / 定期复审（默认 180 天） | 随 PR 同步更新文档（见 4.3）；复审提醒由 CI/看板触发 | `version` 递增；变更记录 |
| **⑤ 归档** | 功能下线 / 版本废弃 / 超期未复审 | 移动至 `docs/archive/`，`status: archived`，门户隐藏但保留可追溯；**只归档不删除** | 归档索引更新 |

### 4.2 角色与责任（RACI 矩阵）

| 角色 | 创建 | 评审（技术） | 评审（语言/规范） | 发布 | 定期复审 | 归档 |
|------|:----:|:----:|:----:|:----:|:----:|:----:|
| 文档编写者（Contributor） | R | C | C | — | C | — |
| 模块 Owner | C | R | C | C | R | C |
| 技术文档负责人（Technical Writer） | C | A | R | A | A | R |
| 技术负责人（Tech Lead） | — | A | A | A | C | A |
| DevOps / 部署负责人 | — | C（ops 类） | — | C | C | C |

> R=执行者，A=最终责任人，C=被咨询，I=被告知（未列）。**关键原则：每篇文档必须有唯一 Owner（Frontmatter `owner`），Owner 对文档时效性负最终责任。**

### 4.3 文档与代码同步机制（防漂移）

1. **PR 文档门禁（GitHub Action）**：`docs-changed` 检查 —— 若 PR 修改 `src/lib/` 下模块（含新增/删除/重命名文件或导出 API），则要求同时修改对应文档；缺失时 PR 标注 ⚠️ 但不强制阻断（先提示，二期升级为阻断）。
2. **API 漂移检查**：`openapi diff` 在 CI 中对比 `/api/v1` 路由定义与 `docs/api/reference.md` 的生成源，不一致即失败。
3. **schema 漂移检查（已有）**：`prisma migrate diff --exit-code` 已在 CI，文档侧补充：`prisma/schema.prisma` 变更必须同步 `docs/architecture/db-schema.md` 与迁移文档。
4. **链接有效性检查**：CI 校验所有内部相对链接与图片引用，死链即失败。
5. **变更同步清单**：PR 模板加入「文档影响」勾选项（改动模块 / 影响文档 / 是否更新），强制编写者自检。

### 4.4 评审与质量门禁

**评审 Checklist（`docs-review`，见附录 B）核心项：**

- [ ] Frontmatter 字段完整且合法（CI 自动校验）
- [ ] 「5 秒测试」通过：标题 + description 能说明「这是什么、为什么重要、怎么开始」
- [ ] 代码示例已实测可运行
- [ ] 术语与术语表一致
- [ ] 内部链接有效、图片存在
- [ ] 属于正确象限（tutorial/how-to/reference/explanation 不混写）
- [ ] 一个概念一个章节，无信息墙
- [ ] Owner 已指定、`applies_to` 版本已标注

### 4.5 版本控制与归档策略

- **文档版本**：与软件版本解耦，独立语义化（`major.minor.patch`，Frontmatter `version`）；`applies_to` 声明适用的软件版本区间。
- **分支策略**：文档随代码走同一分支/PR（docs-as-code 核心）；大版本发布时用 Git tag 关联文档快照。
- **归档规则**：
  - 功能下线 → 文档移动至 `docs/archive/<category>/`，`status: archived`；
  - 大版本变更 → 旧版本文档保留在 archive，新版本在正式目录；
  - 归档文档在门户隐藏但可搜索（标注「已归档」），**禁止删除**（可追溯原则）。

---

## 五、工具与平台

### 5.1 选型对比

| 方案 | 模式 | 优点 | 缺点 | 适合场景 |
|------|------|------|------|----------|
| **VitePress** | docs-as-code（Markdown 入库） | 轻量、Vue 生态、与代码同仓库、版本可追溯、CI 自动构建 | 需一定前端配置 | ✅ **推荐主站** |
| Docusaurus | docs-as-code | 功能全（版本化/多语言/搜索插件） | 重，React 生态，配置复杂 | 大规模多版本公开文档 |
| MkDocs + Material | docs-as-code | Python 生态、主题美观 | 与 JS 项目栈割裂 | Python 团队 |
| Confluence / Notion / 腾讯文档 | 在线协作 | 上手快、实时协作 | 无代码关联、版本追溯弱、易失控 | 产品/运营文档、会议纪要 |
| 语雀 / 飞书文档 | 在线协作 | 中文体验好 | 同上 | 团队知识沉淀 |

### 5.2 推荐组合（KnowledgeAI 落地）

| 层 | 选择 | 理由 |
|----|------|------|
| **内容存储** | 仓库 `docs/`（Git 管理） | 与代码同 PR、可追溯、可评审 |
| **文档站点** | **VitePress**（`docs/` 作为 content root） | 与 Next.js 项目共存互不干扰；`pnpm dev` 文档站点独立端口 |
| **在线协作** | 腾讯文档（草稿/评审批注）/ 飞书（存量团队迁移可选） | 轻量讨论，定稿后落库 |
| **API 参考** | OpenAPI 3.0 规范（已有）+ **Redocly/`@redocly/cli`** 生成 + lint | 单一事实源，防手写漂移 |
| **静态分析** | markdownlint + Vale（语言风格）+ remark-lint | CI 自动检查格式与语气 |
| **图** | Mermaid（Markdown 内嵌，VitePress 原生支持） | 架构图随文档版本化 |
| **搜索** | VitePress 内置搜索 / `@cmfcmf/docusaurus-search-local` 思路的 local-search 插件 | 中文分词配置 |
| **CI** | GitHub Actions（复用现有工作流）：`docs-check` job | 元数据/链接/OpenAPI diff/构建 |

### 5.3 版本管理方式

- **Git 分支 + PR 评审**：所有文档变更走 PR（L2 以上需 1 人以上 approve）。
- **发布关联**：`pnpm build` 前文档站点构建纳入 CI；发布 tag（`v1.2.0`）同时归档该版本文档快照。
- **长期版本策略**：对外 SDK/API 文档按 `applies_to` 提供版本下拉（VitePress 多版本目录），内部文档只维护 latest。

### 5.4 具体落地配置（VitePress 快速接入）

```bash
# 在仓库根新增 docs-site 工作区（或用独立分支）
pnpm add -D vitepress
# vitepress.config.ts 指向 docs/ 作为 content root
```

CI 新增 `docs-check` job（建议三阶段）：

1. `markdownlint docs/`（格式）+ `vale docs/`（术语/语气）
2. Frontmatter 必填字段校验（自研脚本或 `frontmatter-check`）
3. 内部链接有效性检查（`remark-validate-links`）→ `pnpm docs:build`

---

## 六、落地实施

### 6.1 四阶段推进计划

#### 阶段一：现状盘点与规范发布（第 1–2 周）

| 任务 | 产出 | 责任人 |
|------|------|--------|
| 文档资产全面盘点（含 SDK/集成仓库） | 差距清单（本方案 1.2 扩充为跟踪表） | 文档负责人 |
| 发布编写规范 v1.0（第三章内容） | `docs/standards/` 首批规范 + 术语表初稿 | 文档负责人 + 技术负责人 |
| 搭建 VitePress 骨架 + CI `docs-check` 初版 | 可访问的文档站点（先托管现有文档） | 前端负责人 |
| 制定文档模板与评审 Checklist | 附录 A/B 落盘为模板文件 | 文档负责人 |

#### 阶段二：模板制定与关键文档补齐（第 3–6 周）

| 任务 | 产出 | 责任人 |
|------|------|--------|
| 补齐架构文档：overview + RAG + Agent + Auth + Queue | `docs/architecture/*`（含 Mermaid 图） | 各模块 Owner |
| 生成 API 指南与参考（OpenAPI 自动化） | `docs/api/*` + SDK 三语言使用文档 | API 负责人 |
| 编写部署运维手册与环境变量全表 | `docs/ops/*` | DevOps 负责人 |
| 拆分重构存量超大文档（设计说明/ROADMAP） | 规范的多文件结构 + 归档 | 文档负责人 |
| 建立 CHANGELOG 机制 | `docs/changelog/CHANGELOG.md` | 技术负责人 |

#### 阶段三：试点团队验证（第 7–8 周）

- **试点范围**：RAG 引擎 + API/SDK 两个模块（覆盖四象限全部类型）。
- **验证动作**：
  1. 新成员按 onboarding 文档独立完成环境搭建（记录耗时，目标 < 1 天）；
  2. 外部视角试用 API 指南完成一次知识库创建 + 流式问答调用；
  3. 收集反馈并修订模板与规范（文档体系的「用户测试」）。
- **通过标准**：试点文档 0 死链、示例 100% 可运行、新成员上手 < 1 天、反馈问题闭环。

#### 阶段四：全面推广与持续运营（第 9 周起）

- 全员文档日（每周固定 0.5 天用于文档贡献）；
- PR 文档门禁从「提示」升级为「阻断」（4.3 二期）；
- 建立文档复审日历（按 `review_interval` 自动生成工单）；
- 上线质量仪表盘（6.2 指标按月度量并公示）。

### 6.2 质量指标体系

| 维度 | 指标 | 计算方式 | 目标值 | 采集方式 |
|------|------|----------|--------|----------|
| **覆盖率** | 模块文档覆盖率 | 已文档化模块 / 全部模块（`src/lib/*` 对照） | ≥ 90%（上线后 3 个月） | CI 脚本扫描 |
| | API 端点覆盖率 | 已文档化端点 / OpenAPI 全部端点 | 100% | OpenAPI diff |
| | 环境变量覆盖率 | 已文档化变量 / `.env.example` 全部变量 | 100% | CI 脚本对比 |
| **使用频次** | 页面访问量（PV/UV） | VitePress 站点分析 | 环比增长 | 站点埋点 |
| | 搜索命中率 | 有效搜索 / 总搜索（无结果占比 < 10%） | ≥ 80% 满意 | 站内搜索日志 |
| | 高频文档 Top10 | 访问排行（驱动优化优先级） | 每月回顾 | 站点分析 |
| **满意度** | 文档反馈评分 | 每页「有用/没用」按钮 + 评分 | ≥ 4.0 / 5.0 | 页面内嵌反馈 |
| | 工单关联下降率 | 被 FAQ/文档覆盖主题的工单量 | 环比下降 30% | 工单系统打标 |
| **时效性** | 文档新鲜度 | 未过期文档（reviewed_at 有效）/ 全部 | ≥ 95% | 定期扫描 |
| | 过期文档占比 | deprecated / 全部 | ≤ 5% | 定期扫描 |
| **完整性** | 示例可运行率 | 实测通过示例 / 全部示例 | 100% | CI 冒烟抽测 |
| | 死链率 | 失效链接 / 全部链接 | 0 | CI 检查 |

### 6.3 度量采集与运营机制

- **自动化采集**：CI 输出覆盖率/死链/过期数据 → 写入 `docs-metrics.json` → 门户展示。
- **月度文档评审会**：回顾指标、确定 Top 优先级文档改进项、分配任务。
- **反馈闭环**：每页「文档反馈」入口 → 自动建 GitHub Issue → 责任人认领。
- **激励机制**：文档贡献纳入代码评审同等权重；季度「文档之星」。

### 6.4 常见风险与应对

| 风险 | 应对 |
|------|------|
| 文档建设被开发任务挤占 | PR 门禁 + 文档日固定时间盒 + 管理层支持 |
| 文档过期后无人维护 | 唯一 Owner + 复审日历自动提醒 + 过期自动降级 |
| 规范被执行走样 | CI 自动化校验（机器兜底）+ 月度抽检 |
| 迁移期间死链 | 迁移脚本批量改链 + CI 链接检查兜底 |
| 团队不习惯 docs-as-code | 阶段三试点成果展示 + 模板降低门槛（复制即用） |

---

## 七、附录

### A.1 新文档模板（Draft）

```markdown
---
title: <文档标题>
description: <一句话描述，含 2-3 个检索词>
type: <tutorial | how-to | reference | explanation>
category: <getting-started | architecture | api | standards | ops | faq>
level: L1
version: 0.1.0
authors: [<你的名字>]
owner: <负责人>
reviewed_at: <今天>
review_interval: 180
status: draft
applies_to: ">=1.2.0"
---

# <标题>

<!-- 1. 目的：这篇文章帮读者达成什么结果（1-2 句） -->

## 背景 / 前置条件

<!-- 读者需要已掌握什么、已安装什么 -->

## 正文

<!-- 一个概念一个章节；代码示例标注语言且可运行 -->

## 常见问题

## 相关文档

- [链接]
```

### A.2 架构决策记录（ADR）模板

```markdown
---
title: "ADR-00XX：<决策标题>"
type: explanation
category: architecture
level: L1
version: 1.0.0
status: accepted
date: 2026-08-20
---

# ADR-00XX：<决策标题>

## 状态
已接受（proposed / accepted / superseded）

## 背景
<!-- 为什么需要决策？约束条件是什么？ -->

## 决策
<!-- 明确、简洁地陈述决策 -->

## 备选方案
<!-- 考虑过的其他方案及被否原因 -->

## 后果
<!-- 正面后果、负面后果、回滚方式 -->

## 相关 ADR
<!-- 关联决策链接 -->
```

### B. 文档评审 Checklist（PR Reviewer 用）

```markdown
- [ ] Frontmatter 必填字段完整且合法
- [ ] 属于正确象限，不混写（教程/指南/参考/解释）
- [ ] 5 秒测试通过：这是什么 / 为什么重要 / 怎么开始
- [ ] 代码示例已实测且标注语言
- [ ] 术语与术语表一致
- [ ] 内部链接与图片有效
- [ ] 一个概念一个章节，单篇 < 500 行
- [ ] Owner 与 applies_to 已填写
- [ ] 涉及代码变更的，文档已同步更新（PR 门禁确认）
```

### C. 术语表（初始，随使用扩充）

| 术语 | 定义 | 备注 |
|------|------|------|
| 知识库（KB） | 文档上传、解析、索引后的可检索集合 | 统一不称「资料库」 |
| RAG | 检索增强生成：检索 + 生成组合问答 | — |
| Agent / 智能体 | 多阶段编排的调研执行单元 | 统一用 Agent |
| KB 文档 | 知识库内的单篇文档 | 区别于「文档（docs）」 |
| 工作区（Workspace） | 多租户隔离单元 | — |
| Provider | 外部服务适配层（LLM/DB/存储等） | 沿用代码术语 |
| SSE | Server-Sent Events 服务端推送 | 用于流式问答/Agent 进度 |

### D. 与现有资产的对齐建议（快速启动清单）

1. 将本方案评审通过后，先把 **第三章编写规范 + 附录模板** 落盘为 `docs/standards/`；
2. 搭建 VitePress 骨架，把现有 4 篇核心文档原样挂载（先解决「可访问性」）；
3. 按 6.1 阶段一启动，两周内产出第一版门户。

---

> **文档修订记录**
>
> | 版本 | 日期 | 变更 |
> |------|------|------|
> | v1.0 | 2026-08-20 | 初稿：现状盘点 + 体系设计 + 落地路径 |
