import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://knowledgeai.app"),
  title: {
    default: "KnowledgeAI — AI 知识助手 SaaS",
    template: "%s · KnowledgeAI",
  },
  description:
    "上传文档，AI 自动构建知识库，团队智能问答，自动生成调研报告。一站式企业级 AI 知识平台。",
  keywords: [
    "AI 知识库",
    "RAG 问答",
    "Agent 调研",
    "知识管理",
    "SaaS",
    "KnowledgeAI",
  ],
  openGraph: {
    title: "KnowledgeAI — AI 知识助手 SaaS",
    description:
      "上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告",
    type: "website",
    locale: "zh_CN",
  },
};

// Apply theme before hydration to avoid a flash of the wrong theme.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('kai-theme');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (!t && m)) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
      </body>
    </html>
  );
}
