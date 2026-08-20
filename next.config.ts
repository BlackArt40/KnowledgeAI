import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Fix Turbopack workspace-root inference when a stray lockfile exists in a
  // parent directory (e.g. ~/package-lock.json) - without this, dev can hang.
  turbopack: {
    root: __dirname,
  },
  // Optional production dependencies - not bundled, resolved at runtime.
  // These are dynamically imported and gracefully fall back when not installed.
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "stripe", "mammoth", "xlsx", "tesseract.js", "pdfjs-dist", "@napi-rs/canvas", "qrcode", "pino"],
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
  // 图片优化允许的域名
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
