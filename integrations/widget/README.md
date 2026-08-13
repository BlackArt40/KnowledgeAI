# KnowledgeAI 嵌入组件（Embeddable Widget）

零依赖、单文件、可独立部署到任意静态站点的 AI 问答组件（P7-2）。

## 独立部署

`public/widget/kai-widget.js` 就是整个组件 —— 拷贝这一个文件到任意静态服务器
（Nginx / GitHub Pages / OSS / S3 均可），然后：

```html
<!-- 放到任意网站的任意页面 -->
<script src="https://your-static-host/kai-widget.js"></script>
<script>
  KnowledgeAIWidget.init({
    endpoint: "https://ai.example.com", // KnowledgeAI 服务地址
    apiKey:   "kai_sk_...",             // chat:read 权限的 API Key
    kbId:     "kb_xxx",                 // 目标知识库
    title:    "AI 助手",                // 可选，面板标题
    theme:    "auto",                   // 可选：light | dark | auto
  });
</script>
```

## 说明

- **独立认证**：组件使用自己的 API Key（`Authorization: Bearer`），在服务端按
  `apikey:<keyId>` 维度独立限流，不占用任何登录用户额度。
- **CORS**：服务端对 `/api/*` 已放行跨域（仅限 Header 鉴权，无 Cookie）。
- 支持暗色模式跟随系统；聊天记录不落库（纯前端展示）。
- 演示页：`public/widget/demo.html`（把 widget 目录放到任意静态服务器即可预览）。

## 安全提示

API Key 会暴露在页面源码中 —— 请为组件创建**专用密钥**（仅勾选 `chat:read`
权限），并在服务端 API 密钥管理中定期轮换。
