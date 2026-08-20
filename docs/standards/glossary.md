---
title: 术语表
description: KnowledgeAI 文档与代码中的统一术语定义，首次出现应链接本表，禁止同义混用
type: reference
category: standards
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [doc-writing-standards.md]
---

# 术语表

> 本文档统一 KnowledgeAI 文档中的术语。**写作与评审时以本表为准**；新术语请追加到本表并标注首次出处。

## 核心术语

| 术语 | 定义 | 备注 |
|------|------|------|
| 知识库（KB） | 文档上传、解析、索引后的可检索集合 | 统一不称「资料库」 |
| KB 文档 | 知识库内的单篇文档 | 区别于「文档（docs）」 |
| 工作区（Workspace） | 多租户隔离单元 | — |
| RAG | 检索增强生成：检索 + 生成组合问答 | 全称 Retrieval-Augmented Generation |
| Agent / 智能体 | 多阶段编排的调研执行单元 | 统一用 Agent |
| 文档处理管线 | 解析 → 切片 → 嵌入 → 入库的处理链路 | 与「索引」同义 |
| Provider | 外部服务适配层（LLM / DB / 存储等） | 沿用代码术语 |
| 演示模式 | 未配置真实服务时自动回退的内存模式 | 配置即切换 |
| 写穿（write-through） | 变更先写内存、异步持久化到 DB 的模式 | 架构核心 |

## 技术术语（保留英文）

| 术语 | 说明 |
|------|------|
| SSE | Server-Sent Events 服务端推送，用于流式问答 / Agent 进度 |
| RBAC | 基于角色的访问控制（四角色：Owner / Admin / Editor / Viewer） |
| OpenAPI | 开放 API 规范，API 参考文档的单一事实源 |
| SDK | 软件开发工具包（JavaScript / Python / Go） |
| Webhook | 事件回调（HMAC 签名 + 队列重试） |
| 2FA / TOTP | 双因素认证 / 基于时间的一次性密码 |
| ADR | 架构决策记录（Architecture Decision Record） |
| docs-as-code | 文档即代码：文档随代码走 Git / PR / CI |

## 禁止混用对照

| 统一写法 | 禁止写法 |
|----------|----------|
| 知识库（KB） | 资料库、文档库 |
| Agent | 机器人、Bot、智能体引擎 |
| 文档处理管线 | 解析流程、切片流程 |
| 演示模式 | demo 模式、本地模式 |
| 智能问答 | 对话机器人、问答引擎 |
