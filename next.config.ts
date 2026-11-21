import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Fix Turbopack workspace-root inference when a stray lockfile exists in a
  // parent directory (e.g. ~/package-lock.json) - without this, dev can hang.
  turbopack: {
    root: __dirname,
  },
  // Runtime-resolved dependencies - not bundled, loaded via dynamic import at
  // runtime. Most are hard dependencies; only the two @aws-sdk packages are
  // optionalDependencies (graceful S3 fallback when absent).
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "stripe", "mammoth", "xlsx", "tesseract.js", "pdfjs-dist", "@napi-rs/canvas", "qrcode", "pino"],
  // 单镜像部署：Vue 构建产物在 public/，由 Next 同时服务页面与 API。
  // `/` 返回预渲染 home.html；其余页面走 SPA index.html。
  // API、Next 静态资源、public 子目录与 PWA 文件不参与 fallback。
  async rewrites() {
    return [
      { source: "/", destination: "/home.html" },
      {
        source:
          "/((?!api(?:/|$)|_next(?:/|$)|assets(?:/|$)|vendor(?:/|$)|widget(?:/|$)|icons(?:/|$)|sw\\.js$|sw-config\\.json$|manifest\\.webmanifest$|favicon\\.ico$|index\\.html$|home\\.html$).*)",
        destination: "/index.html",
      },
    ];
  },
  // 生产安全响应头
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // P5-1: camera=(self) so the mobile camera upload (capture attribute)
          // works; microphone / geolocation stay blocked.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // L-10: Content-Security-Policy - restrict where scripts/styles/
          // connections can load from. Next.js dev needs unsafe-inline +
          // unsafe-eval (Turbopack HMR); production keeps them for Next's
          // inline runtime but connect-src is locked to self + the LLM /
          // payment / CDN backends actually used. frame-ancestors = none
          // (X-Frame-Options DENY already set, CSP reinforces it).
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.openai.com https://*.openai.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
