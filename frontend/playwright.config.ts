import { defineConfig } from "@playwright/test";

// V1 前端 e2e：页面由 vite dev（:5173）承载，/api 经 vite proxy 到 Next dev
// （:3000，单体模式全量 API 可用）。webServer 数组自动拉起两端，本机已起则复用。
// 与根 e2e（打 Next 页面）互为双轨：旧套件全程保持绿，本套件覆盖 Vue 已接管路由。
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // dev server（双进程共享）负载下偶发超时 —— 本地重试 1 次压掉抖动
  retries: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5173",
    locale: "zh-CN",
  },
  webServer: [
    {
      // 套件 ~9 次登录会撞匿名限流（默认 20/min）——与 CI integration 同口径抬高
      command:
        "RATE_LIMIT_ANON_PER_MIN=1000 RATE_LIMIT_PER_MIN=1000 RATE_LIMIT_KB_PER_MIN=1000 pnpm --filter kai-app dev",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
