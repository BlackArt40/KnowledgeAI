# KnowledgeAI 🧠

> 上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告。
> 一站式企业级 AI 知识平台。

## ✨ 核心功能

| 模块 | 功能 | 技术 |
| --- | --- | --- |
| 知识库 | 文档上传 / 解析 / 切片 / 向量化 / 管理 | 多格式提取 + 处理管线 |
| 智能问答 | RAG 检索 + 流式生成 + 引用溯源 + 联网搜索开关 | 异步 RAG + LLM Provider + SSE + 外部 Web 源 |
| Agent 调研 | 多 Agent 编排（规划→检索→分析→撰写） | SSE 流式 + Markdown 报告 |
| 团队协作 | RBAC 权限 / 邀请 / 审计日志 / 共享 KB / 实时协作（在线状态 + KB 实时变更 + 共享会话）/ 文档级权限 + 临时分享链接 / 多租户 Workspace 隔离与切换 | 4 角色 × 10 能力 + SSE 实时推送 + 继承链权限 + 租户隔离 |
| AI 模型 | 导入外部 LLM / 连接测试 / 一键切换 | OpenAI·DeepSeek·Moonshot·硅基流动·Ollama |
| 订阅计费 | 套餐 / 订单 / 账单 / 用量计量 / 收银台 | 状态机 + 支付模拟 |
| 系统管理 | 用户管理 / 系统统计 / KB 监控 / 配置 | Owner/Admin 后台（RBAC 守卫） |
| 通知中心 | 4 通道通知 / 偏好持久化 / 铃铛下拉 | 登录/KB/Agent 事件触发 |
| 安全隐私 | 2FA / 会话管理 / 登录历史 / GDPR 导出 / 加密存储 / 审计链 | 合规数据权利 + AES-256-GCM + 哈希链审计 |

## 🛠 技术栈

- **框架**：Next.js 16（App Router · Turbopack · Route Handlers · SSE 流式）
- **样式**：Tailwind CSS v4 + CSS 变量设计令牌（亮 / 暗双模式）
- **组件**：shadcn 风格自建组件库（15 个基础组件）
- **图标**：lucide-react + 自绘品牌图标
- **语言**：TypeScript 严格模式 · React 19
- **生产适配**：LLM Provider（含运行时导入外部模型）/ Payment / Database / Storage / Rate Limit / Auth

## 🚀 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev          # → http://localhost:3000

# 生产构建
pnpm build
pnpm start

# 代码检查
pnpm lint
```

## 🔑 演示账号

登录页提供 4 个演示账号（密码均为 `password123`），覆盖不同权限角色：

| 邮箱 | 角色 | 权限范围 |
| --- | --- | --- |
| owner@knowledgeai.dev | Owner | 全部权限（含管理后台） |
| admin@knowledgeai.dev | Admin | KB 管理 + 成员管理 |
| editor@knowledgeai.dev | Editor | KB 编辑 + 问答 + Agent |
| viewer@knowledgeai.dev | Viewer | KB 只读 + 问答 |

也可自行注册新账户（默认 Editor 角色）。

## 📁 项目结构

```
src/
├── app/            # Next.js App Router（页面 + API 路由）
├── components/      # React 组件（ui 基础库 + app 业务 + marketing）
├── lib/             # 业务逻辑（auth/kb/rag/agent/queue/db/storage…）
└── proxy.ts         # 中间件（限流 + DB 水合）
prisma/              # 数据库 schema + 迁移 + 种子
scripts/             # 运维脚本（清理/迁移/CI 检查）
└── smoke/           # 手动冒烟测试
tests/               # 集成测试（需 dev server）
docs/                # 产品文档 / 设计说明 / 路线图
```

> 完整目录说明见 [docs/项目结构.md](docs/项目结构.md)。

## 🐳 Docker 部署

```bash
# 复制环境变量
cp .env.example .env.local

# 构建并运行（含 Redis）
docker compose up -d

# 或单独构建镜像
docker build -t knowledgeai .
docker run -p 3000:3000 --env-file .env.local knowledgeai
```

## 📁 项目结构

```
src/
├── app/
│   ├── (app)/          # 工作台页面（AppShell 包裹）
│   ├── (auth)/         # 登录 / 注册 / 验证
│   ├── api/            # 40+ Route Handlers
│   ├── privacy/        # 隐私政策
│   ├── terms/          # 服务条款
│   ├── maintenance/    # 维护页
│   ├── not-found.tsx   # 404
│   └── error.tsx       # 500
├── components/
│   ├── ui/             # 基础组件库
│   ├── app/            # 工作台组件
│   ├── marketing/      # 落地页组件
│   └── icons/          # 品牌图标
└── lib/
    ├── rag/             # RAG 引擎（全异步：嵌入/检索/生成）
    ├── llm/             # ⭐ LLM Provider（OpenAI 兼容 + 本地回退）
    ├── models/          # ⭐ 外部模型管理（6 预设 + 连接测试 + 拉取列表）
    ├── notifications/   # ⭐ 通知系统（4 通道 + 偏好 + 收件箱）
    ├── kb/              # 知识库 + 处理管线
    ├── chat/            # 会话存储
    ├── agent/           # 多 Agent 编排
    ├── external/        # 外部数据源（Web 搜索 + ArXiv + GitHub，Agent/Chat 共用）
    ├── team/            # RBAC 权限
    ├── billing/         # 订阅计费 + Stripe Provider
    ├── apikeys/         # API 密钥
    ├── security/        # 安全 + GDPR
    ├── admin/           # 管理后台
    ├── db/              # ⭐ 数据库适配（Prisma + Repository）
    ├── storage/         # ⭐ 文件存储适配（S3 / 本地）
    ├── auth/            # ⭐ JWT 认证 + 角色守卫（Web Crypto + guard.ts）
    └── config.ts        # ⭐ Provider 状态聚合
```

## ⚙️ 生产化接入（配置即切换）

所有核心模块通过 Provider 适配层实现「配置即切换」。设置环境变量即启用真实服务，未配置则自动回退到本地演示模式。

| 模块 | 环境变量 | 真实服务 | 演示回退 |
| --- | --- | --- | --- |
| LLM 对话 | `OPENAI_API_KEY` `CHAT_MODEL` 或设置页导入 | OpenAI / DeepSeek / Ollama 等 | 本地抽取式生成 |
| 嵌入向量 | `OPENAI_API_KEY` `EMBEDDING_MODEL` | OpenAI text-embedding-3-small | 本地哈希嵌入 2048 维 |
| 数据库 | `DATABASE_URL` | PostgreSQL (Prisma) | 内存存储 |
| 文件存储 | `S3_ENDPOINT` `S3_BUCKET` | S3 / MinIO / R2 | 本地文件系统 |
| 支付 | `STRIPE_SECRET_KEY` | Stripe Checkout | 模拟支付 |
| 限流 | `RATE_LIMIT_PER_MIN` `RATE_LIMIT_ANON_PER_MIN` `RATE_LIMIT_KEY_PER_MIN` `RATE_LIMIT_KB_PER_MIN` | Redis 滑动窗口（分级：匿名/用户/API Key/KB） | 内存限流 |
| 外部数据源 | `TAVILY_API_KEY` `SERPAPI_KEY` `BRAVE_SEARCH_KEY` `GITHUB_TOKEN` | Tavily / SerpAPI / Brave / ArXiv / GitHub | 模拟外部结果 |
| 密钥加密 | `AUTH_SECRET` | AES-256-GCM + HKDF（API Key / 模型 Key 密文落库，密码 PBKDF2） | 固定 dev key |

```bash
# 1. 复制环境变量模板
cp .env.example .env.local

# 2. 填写需要启用的 Provider（其余保持空则使用演示模式）
#    例如启用 OpenAI：
#    OPENAI_API_KEY=sk-...
#    CHAT_MODEL=gpt-4o-mini
#    EMBEDDING_MODEL=text-embedding-3-small

# 3. （可选）启用数据库
pnpm add @prisma/client
npx prisma migrate deploy

# 4. 启动 — 已配置的 Provider 自动激活
pnpm dev
```

管理后台 `/admin` → 系统配置面板可实时查看各 Provider 启用状态。


## 📄 文档

- [产品文档.md](产品文档.md) — 完整产品规划（7 模块 25 页面）
- [设计说明.md](设计说明.md) — UI 设计体系与实现进度

## 📜 许可

MIT License
