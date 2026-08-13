# KnowledgeAI 代码库问答（VS Code 扩展）

在 VS Code 里直接对代码提问：选中代码 → 右键 → **KnowledgeAI: 对选中代码提问**，回答流式显示在输出面板；也可把整个工作区同步为知识库文档，之后对全库做 RAG 问答。

## 功能

| 命令 | 说明 |
| --- | --- |
| `KnowledgeAI: 对选中代码提问` | 选中代码（或光标所在行）作为问题发给知识库（editor 右键菜单） |
| `KnowledgeAI: 对当前文件提问` | 把当前文件全文作为问题（截断 100KB） |
| `KnowledgeAI: 同步工作区到知识库` | 递归收集工作区代码/文本文件（跳过 node_modules/.git/dist 等，单文件 ≤200KB、共 ≤2MB、≤100 个），逐文件上传为 KB 文档（重名自动跳过） |
| `KnowledgeAI: 配置连接` | 设置服务地址 / API Key / 知识库 ID（存于 VS Code `context.secrets`，不落盘明文） |

## 安装（开发模式）

1. `code --install-extension integrations/vscode-extension/`（或 F5 调试加载本目录）
2. 运行 **KnowledgeAI: 配置连接**：
   - 服务地址：`http://localhost:3000`（或部署地址）
   - API Key：在 KnowledgeAI 后台「API 密钥」创建，勾选 `chat:read`（问答）与 `kb:write`（工作区同步）
   - 知识库 ID：知识库详情页 URL 中的 `kb_xxxx` 段

## 打包

```bash
cd integrations/vscode-extension
npx @vscode/vsce package   # 生成 kai-vscode-0.1.0.vsix
```

## 架构

- `ask.js` / `sync.js`：纯 Node 模块（无 `vscode` 依赖）——SSE 分帧与 `/api/v1/chat`、`/api/v1/knowledge-bases/[id]/documents` 协议，可脱离 VS Code 单测
- `extension.js`：VS Code 命令注册 + `context.secrets` 配置 + 输出面板流式渲染

验收测试：`node scripts/smoke/test-vscode.ts`（manifest 结构 + ask.js/sync.js 对 live server 全流程）。
