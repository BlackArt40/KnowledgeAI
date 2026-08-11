import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/pwa/sw-register";
import { ErrorReporter } from "@/components/obs/error-reporter";
import { LocaleProvider } from "@/lib/i18n/provider";
import { getLocaleFromCookies, serverT } from "@/lib/i18n/server";
import { normalizeLocale } from "@/lib/i18n/translate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// P5-4: metadata is locale-aware (cookie-negotiated via generateMetadata).
export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await serverT();
  const en = normalizeLocale(locale) === "en";
  return {
    metadataBase: new URL("https://knowledgeai.app"),
    title: {
      default: en ? "KnowledgeAI — AI Knowledge Assistant SaaS" : "KnowledgeAI — AI 知识助手 SaaS",
      template: "%s · KnowledgeAI",
    },
    description: en
      ? "Upload documents, AI builds your knowledge base, team Q&A, automated research reports."
      : "上传文档，AI 自动构建知识库，团队智能问答，自动生成调研报告。一站式企业级 AI 知识平台。",
    keywords: en
      ? ["AI knowledge base", "RAG Q&A", "Agent research", "knowledge management", "SaaS", "KnowledgeAI"]
      : ["AI 知识库", "RAG 问答", "Agent 调研", "知识管理", "SaaS", "KnowledgeAI"],
    openGraph: {
      title: en ? "KnowledgeAI — AI Knowledge Assistant SaaS" : "KnowledgeAI — AI 知识助手 SaaS",
      description: en
        ? "Upload documents → AI knowledge base → team Q&A → automated research reports"
        : "上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告",
      type: "website",
      locale: en ? "en_US" : "zh_CN",
    },
    // P5-1 PWA: installable manifest + iOS home-screen integration.
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "KnowledgeAI",
      statusBarStyle: "default",
    },
    icons: {
      apple: "/icons/apple-touch-icon.png",
    },
    formatDetection: {
      telephone: false,
    },
  };
}

// P5-1 PWA: mobile viewport without scaling restrictions + theme color that
// follows the light/dark preference (matches the kai-theme toggle).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

// Apply theme + locale before hydration to avoid a flash of the wrong theme
// / language. The locale cookie also drives server-side rendering.
// P5-5: `kai-theme` is now three-valued - "system" (default, follows the OS
// preference) / "light" / "dark"; `kai-hc` pre-applies high contrast.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('kai-theme');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || ((!t || t === 'system') && m)) document.documentElement.classList.add('dark');
    if (localStorage.getItem('kai-hc') === '1') document.documentElement.classList.add('high-contrast');
    var l = localStorage.getItem('kai-locale');
    if (l === 'en') {
      document.documentElement.lang = 'en';
      document.cookie = 'kai-locale=en; path=/; max-age=31536000';
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocaleFromCookies();
  return (
    <html
      lang={normalizeLocale(locale) === "en" ? "en" : "zh-CN"}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* iOS home-screen mode (Next 16 renders mobile-web-app-capable only;
            Safari still honors the apple-* variant for fullscreen). */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full bg-background font-sans text-foreground">
        <LocaleProvider serverLocale={locale}>
          {children}
        </LocaleProvider>
        <SwRegister />
        {/* P6-1: global client error capture -> /api/obs/report -> Sentry */}
        <ErrorReporter />
      </body>
    </html>
  );
}
