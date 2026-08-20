---
title: UI 设计体系
description: KnowledgeAI UI 设计体系：技术栈、设计令牌、组件库与页面清单
type: explanation
category: architecture
level: L1
version: 1.0.0
authors: [product-team]
owner: 产品负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [overview.md]
---

# KnowledgeAI · UI 设计体系

> 本文为 UI 设计体系说明（原《设计说明.md》第一部分，已拆分归档）。相关后端实现见[设计与实现记录（归档）](../archive/design-and-implementation-log.md)。

---

> 本文档记录已确认的后续开发计划，以及为 KnowledgeAI 设计的简洁美观 UI 体系与已实现的功能。

---

## 一、已确认的后续开发计划

依据《产品概述》（getting-started/product-overview.md），KnowledgeAI 共 **7 大模块、25 个页面**，建议 8–12 周完成。当前进度：

| 阶段 | 内容 | 状态 |
| --- | --- | :---: |
| 第 1–2 周 | 落地页 + 登录注册 + 基础框架 + 设计系统 | ✅ 已完成 |
| 第 3–4 周 | 知识库管理 + 文档上传 + 向量化 | ✅ 已完成 |
| 第 5–6 周 | 智能问答（RAG 核心功能） | ✅ 已完成 |
| 第 7–8 周 | Agent 调研 + 任务队列 | ✅ 已完成 |
| 第 9–10 周 | 团队协作 + 权限系统 | ✅ 已完成 |
| 第 10–11 周 | 订阅计费 + 支付集成 | ✅ 已完成 |
| 第 12 周 | 管理后台 + 安全加固 + 部署上线 | ✅ 已完成 |

**🎉 全部 12 周开发计划 + 生产化接入已完成！** 7 大模块 25 个页面均已实现，且核心模块已具备生产适配层：配置环境变量即可切换至真实 LLM / PostgreSQL / S3 / Stripe，无需改动业务代码。所有适配层均带优雅降级——未配置时自动回退到本地演示模式。

---

## 二、技术栈

- **框架**：Next.js 16（App Router、Turbopack、Route Handlers、SSE 流式）
- **样式**：Tailwind CSS v4 + CSS 变量设计令牌
- **组件**：shadcn 风格自建组件库 16 个（Button / Card / Input / Label / Badge / Separator / Skeleton / Avatar / Dialog / Select / Slider / Progress / Tabs / Switch / Table / DropdownMenu）
- **图标**：lucide-react + 自绘品牌图标
- **字体**：Geist Sans / Geist Mono；**主题**：系统 / 亮 / 暗三模式 + 高对比度（WCAG AA）+ Workspace 品牌色（P5-5）

---

## 三、设计系统

围绕**靛蓝（Indigo）**品牌色构建，辅以紫罗兰渐变高亮。
- 主色 `--primary`：亮 `hsl(243 75% 59%)` / 暗 `hsl(243 80% 67%)`；品牌渐变 `bg-brand-gradient`
- 语义色 `success` / `warning` / `destructive`；圆角 `0.75rem`；柔和阴影；`max-w-6xl`
- 动效：aurora 极光、marquee 跑马灯、打字机流式、处理进度条、卡片 hover 上浮

---

## 四、已实现页面

### 公开区
- `/` 落地页
- `/login` 登录页：邮箱密码登录 + 4 个演示账号一键填充（Owner/Admin/Editor/Viewer）+ Google/GitHub 按钮
- `/register` 注册页：昵称/邮箱/密码注册 + 服务条款同意 + Google/GitHub 按钮
- `/verify-email` 邮箱验证（双栏分屏）

### 工作台（统一 AppShell：侧边栏 + 顶栏）
- `/dashboard` 仪表盘：统计卡 + 用量趋势图（自绘 SVG）+ Agent 任务 + 最近问答（均从 API 实时拉取：`/api/auth/me` + `/api/knowledge-base` + `/api/usage` + `/api/chat/conversations` + `/api/agent/tasks`）
- `/knowledge-base` 知识库列表：卡片网格、新建弹窗、处理中徽标、实时轮询
- `/knowledge-base/[id]` 知识库详情：拖拽上传（XHR 进度）+ 网页链接、文档列表（状态管线+进度条）、设置弹窗、统计概览
- `/chat` **智能问答**（第 5–6 周核心）：知识库选择、会话列表、SSE 流式渲染、引用角标（点击高亮右侧来源）、引用来源面板联动、快捷操作
- `/agent` **Agent 调研**（第 7–8 周核心）：任务输入 + 配置（数据来源/输出格式/检索深度）+ 执行时间线（规划→检索→分析→撰写，SSE 实时）+ Markdown 报告渲染（引用角标）+ 历史任务
- `/team` **团队管理**（第 9–10 周核心）：成员表（角色/状态/最近活跃）+ 邀请弹窗 + 权限矩阵 + 操作日志 + 共享知识库访问权限
- `/billing` **订阅计费**（第 10–11 周核心）：当前套餐卡（取消/恢复订阅）+ 三档套餐对比表 + 账单历史（CSV 导出）→ 选择套餐跳转收银台
- `/usage` **用量监控**（第 10–11 周）：用量计量卡（问答 / API / 存储 / Agent，Progress 进度条）+ 14 天用量趋势图（自绘 SVG）
- `/checkout` **收银台**（第 10–11 周）：套餐确认 + 支付方式（微信/支付宝/信用卡）→ 二维码/处理中 → 支付成功
- `/api-keys` **API 密钥**（第 12 周核心）：密钥列表（创建/禁用/删除）+ 权限范围 + 调用示例（curl/Python/JS）+ 调用日志
- `/settings` **设置**（第 12 周核心）：Tabs 三栏——安全（2FA + 设备管理 + 登录历史）/ 个人信息（密码 + 通知偏好）/ 数据隐私（GDPR 导出 + 删除账户）
- `/admin` **管理后台**（第 12 周核心，仅 Owner/Admin）：系统统计 8 卡 + 收入趋势 + 用户管理（封禁/解封）+ 知识库监控 + 系统配置（模型/限流/维护模式）

### 特殊页面
- `/privacy` 隐私政策（数据收集/使用/安全/用户权利/COOKIE/保留期限）
- `/terms` 服务条款（使用规则 + AI 生成内容免责声明 + 知识产权）
- `/maintenance` 维护中页面
- `not-found.tsx` 404 页面（渐变大字 + 返回首页）
- `error.tsx` 500 错误页（错误码 + 重试 + 联系支持）

---
