# KnowledgeAI Chrome 扩展

网页选中文字 → 右键「发送到 KnowledgeAI 问答」→ 结果页展示 AI 回答（P7-2）。

## 安装（开发模式）

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录 `integrations/chrome-extension/`。
3. 点击扩展图标 → 设置：填写服务地址 / API Key（`chat:read` 权限）/ 知识库 ID。
4. 在任意网页选中一段文字 → 右键 → 「发送到 KnowledgeAI 问答」。

## 结构

- `manifest.json` — MV3 清单（contextMenus + storage 权限）
- `background.js` — Service Worker：右键菜单、结果页桥接（content 页 fetch 受
  页面 CSP 限制，问答请求统一由扩展后台发起）
- `result.html/js` — 问答结果页
- `options.html/js` — 设置页（API Key / 知识库 / 服务地址，存 chrome.storage）

## 说明

- 认证独立：使用专用 API Key，服务端按 `apikey:<keyId>` 维度独立限流。
- 问答走 `/api/v1/chat` SSE 流式接口。
