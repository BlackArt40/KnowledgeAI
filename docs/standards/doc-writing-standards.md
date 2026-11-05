---
title: KnowledgeAI 文档编写规范
description: 统一技术文档的元数据、命名、代码示例、中文排版、术语与检索规范，确保团队协作风格一致、易于检索
type: reference
category: standards
level: L1
version: 1.2.0
authors:
  - technical-writer
owner: 技术文档负责人
reviewed_at: 2026-11-04
review_interval: 180
status: published
applies_to: ">=1.2.0"
---

# KnowledgeAI 文档编写规范

> 本文档定义 KnowledgeAI 技术文档的编写标准。**所有入库 `docs/` 的文档必须遵循本规范**，CI 的 `docs-check` 任务会校验 Frontmatter 完整性与链接有效性。
>
> 配套文件：[新文档模板](templates/new-doc.md) · [ADR 模板](templates/adr.md) · [评审 Checklist](doc-review-checklist.md) · [术语表](glossary.md)

## 适用范围

本规范适用于 `docs/` 下全部正式文档（L1 及以上）。L0 草稿（会议纪要、调研草稿）不要求完整元数据，但**进入正式目录前必须补齐**。

## Frontmatter 元数据

每篇文档**强制**使用 YAML Frontmatter，字段说明如下：

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `title` | ✅ | 文档标题（H1 保持一致） |
| `description` | ✅ | 一句话描述，含 2～3 个检索关键词（用于站点搜索与 SEO） |
| `type` | ✅ | `tutorial` / `how-to` / `reference` / `explanation` 之一 |
| `category` | ✅ | `getting-started` / `architecture` / `api` / `standards` / `ops` / `faq` 之一 |
| `level` | ✅ | `L1` / `L2` / `L3` |
| `version` | ✅ | 语义化版本 `major.minor.patch` |
| `authors` | ✅ | 编写者列表 |
| `owner` | ✅ | **维护责任人（唯一）**，对文档时效性负最终责任 |
| `reviewed_at` | ✅ | 最近评审日期（YYYY-MM-DD） |
| `review_interval` | ✅ | 评审周期（天），默认 `180` |
| `status` | ✅ | `draft` / `review` / `published` / `archived` / `deprecated` |
| `applies_to` | 条件 | 适用的软件版本区间，如 `>=1.2.0`（对外文档必填） |
| `related` | 否 | 相关文档路径列表 |

示例：

```yaml
---
title: RAG 引擎架构说明
description: KnowledgeAI RAG 检索增强生成引擎的模块划分、检索链路与可扩展点
type: explanation
category: architecture
level: L1
version: 1.0.0
authors: [zhang-san]
owner: rag-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [../standards/glossary.md]
---
```

### 时效性规则

- `reviewed_at` 距今超过 `review_interval`：文档门户标注 ⚠️ 待复审；
- 超过 2 个周期仍未复审：`status` 自动降级为 `deprecated`，门户隐藏、归档处理。

## 命名规范

| 对象 | 规范 | 示例 |
|------|------|------|
| 目录名 | 英文 kebab-case | `getting-started/`、`architecture/` |
| 文件名 | 英文 kebab-case | `rag-engine.md`、`env-vars.md` |
| 标题 | H1 用中文自然语言，不用文件名代替 | `RAG 引擎架构说明` |
| 图片 | 描述性命名，存放于所属文档目录的 `assets/` | `assets/rag-flow.png` |
| 链接 | 相对路径，禁止绝对路径与外部裸链 | `../architecture/overview.md` |

> 存量中文文件名已于 2026-08-20 全部迁移为 kebab-case。改名只保证站内相对链接同步更新；VitePress 的 `rewrites` 只决定“源文件 → 输出路径”，**不能把旧 URL 重定向到新路径**，因此站外收藏的旧地址不保证可用（改名前请先 `grep` 全仓引用）。

## 代码示例风格

1. **标注语言**：所有代码块必须写语言标识（`typescript`、`bash`、`yaml`、`json`…），保证高亮与检索。
2. **必须可运行**：L2 及以上文档的示例须在干净环境实测；关键示例纳入 CI 冒烟（复用 `scripts/smoke/` 模式）。
3. **占位符约定**：必填项用 `<...>`，可选项用 `[...]`，示例后注明取值来源：

   ```bash
   curl -X POST http://localhost:3000/api/v1/knowledge-bases \
     -H "Authorization: Bearer <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name": "我的知识库"}'
   ```

4. **预期输出**：用独立代码块标注“预期输出”。
5. **路径规范**：项目路径从仓库根 `KnowledgeAI/` 表述。
6. **敏感信息**：密钥、Token 一律占位符，禁止真实值。

## 术语与语言标准

- **语气**：第二人称（“你”）、现在时、主动语态。
  - ❌ “依赖包应被安装”；✅ “安装依赖包”
- **术语一致**：术语以[术语表](glossary.md)为准，首次出现链接到术语表；禁止同义混用（如“知识库/资料库”“机器人/Bot”）。
- **中英混用**：专有名词与技术术语保留英文（RAG、SSE、RBAC、OpenAPI）；正文用中文；代码注释与提交信息用英文。
- **标题层级**：每篇仅一个 H1；层级不跳级（H1→H2→H3）；标题用名词短语。
- **文档长度**：单篇尽量 < 500 行；超长拆分子页并建立索引。
- **AI 生成标记**：AI 辅助编写的文档须标注“AI 辅助编写，已人工校核”。

## 中文排版

中文排版以[《中文技术文档的写作规范》](https://github.com/ruanyf/document-style-guide)（阮一峰）为准，本仓库的落地细则如下：

- **字间距**：中文与英文、中文与半角数字之间留一个半角空格（`启动 Windows 系统`、`5 分钟`）；半角标点两侧不留空格（`MacBook Air。` 而非 `MacBook Air 。`）。
- **标点**：中文语句一律使用全角标点，含全角双引号 `“ ”` 与顿号 `、`；并列词之间用顿号，不用逗号；不使用 `...`，中文省略号写作 `⋯⋯`。
- **括号**：括号内含中文时用全角 `（）`，内容为纯英文标识时保留半角 `()`，同一文档内保持一致。
- **数值**：用半角阿拉伯数字；4 位以上加千分位分隔符（`1,024` 而非 `1024`）；表示范围用波浪连接号 `～`（`132 kg～234 kg`、`2～3 个`），并给两端都带单位。
- **标题**：每篇仅一个 H1，层级不跳级，避免四级标题（并列内容改用 `**（1）**` 加粗编号）；标题末尾不加句号、逗号、顿号、分号与冒号。
- **段落与句子**：一个段落只讲一个主题，中心句置于段首，单段不超过 7 行；单句尽量控制在 20 字以内，超过 40 字必须拆分。
- **语态**：使用陈述语气与主动语态，避免感叹号、被动句与双重否定。
- **文件名**：小写 kebab-case，不含空格与中文（`README`、`LICENSE` 等说明文件除外）。

## 检索与 SEO

- `description` 必须包含核心检索词（如“KnowledgeAI RAG 部署 PostgreSQL”）。
- 文档门户 [docs/index.md](../index.md) 提供分类索引 + 关键词速查表。
- 统一标签体系：`部署`、`鉴权`、`故障排查`、`RAG`、`API`、`SDK` 等。
- 对外公开文档启用站点搜索（VitePress local search）。

## 版本与修订记录

- **始终一致**：frontmatter `version` 必须等于修订记录表里的最新版本号；无表的文档改内容时也要递增 `version`。版本表按时间排序，新行加在最新端（仓库内两种排序并存，改动时沿用该文件既有顺序）。
- **实质变更要登记**：事实订正、口径变化、结构拆分、章节增删——递增次版本号，追加一行说明，并同步 `reviewed_at`。
- **纯排版不递增**：错别字、标点、空格、链接修复不 bump 版本、不动 `reviewed_at`（这类改动无需登记，避免修订表被噪声淹没）。

## 评审与发布

- 每篇文档按[评审 Checklist](doc-review-checklist.md) 逐项核对；
- 文档变更随代码走同一 PR(docs-as-code)；PR 模板勾选“文档影响”；
- 发布由 CI 校验通过后合入主分支，站点自动构建。

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据《技术文档体系方案》第三章；方案已归档至 archive/technical-docs-strategy.md） |
| 1.1.0 | 2026-11-04 | 新增“中文排版”一节：对齐《中文技术文档的写作规范》，明确空格、标点、括号、数值、标题、段落与文件名细则；全站文档同步按该规范整改 |
| 1.2.0 | 2026-11-05 | 新增“版本与修订记录”一节：frontmatter `version` 必须与修订表最新行一致；实质变更递增并更新 `reviewed_at`，纯排版改动不 bump（此前 36 篇文档因规则缺失未 bump） |
