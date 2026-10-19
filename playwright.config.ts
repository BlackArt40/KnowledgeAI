// P6-3 → V6：E2E 关键用户流程（登录 → 上传 → 问答 → Agent）。
// V6 退役后 Next 只服务 /api/**，页面由 vite preview（:4173，服务 frontend
// dist 含 SEO 预渲染 home.html）承载——双 webServer：Next dev 提供 API、
// preview 提供页面，用例统一打 :4173（/api 经 preview proxy 到 :3000）。
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    // 固定中文 locale：应用按语言包渲染，E2E 断言基于中文文案
    locale: "zh-CN",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Next dev：纯 API（V6 后无页面路由），沿用高限流 env（套件十几次
      // 匿名请求会撞 20/min 档；限流档位本身由 smoke limits 组断言）
      command: "pnpm dev",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        RATE_LIMIT_PER_MIN: "2000",
        RATE_LIMIT_ANON_PER_MIN: "1000",
        RATE_LIMIT_KB_PER_MIN: "2000",
        RATE_LIMIT_KEY_PER_MIN: "5000",
        RATE_LIMIT_AGENT_PER_MIN: "60",
      },
    },
    {
      // vite preview：构建（含 SEO 预渲染）后服务 frontend/dist @ :4173
      command:
        "pnpm --filter kai-frontend build && pnpm --filter kai-frontend exec vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
