// V6 退役：Next 退为纯 API 服务（src/app 仅剩 /api/** + 本根 layout）。
// 页面层（(app)/(auth)/营销页等 28 页）已由 frontend/（Vue 3）全量接管，
// 主题/语言预置、PWA 注册（frontend/src/pwa/sw-register.ts）与错误上报
// （frontend 侧 error-reporter）随页面层迁移。App Router 编译要求存在根
// layout——保留最小 html 壳与基础 metadata（API 路由不渲染页面，此壳仅供
// 框架启动，正常流量不会命中）。
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "KnowledgeAI — AI 知识助手 SaaS",
  description: "上传文档，AI 自动构建知识库，团队智能问答，自动生成调研报告。一站式企业级 AI 知识平台。",
  manifest: "/manifest.webmanifest",
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
