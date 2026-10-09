// P6-3: Playwright config - E2E for the key user flow
// (login -> upload -> Q&A -> Agent). The webServer entry auto-starts
// `pnpm dev` on port 3000 (reused when one is already running locally).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    // 固定中文 locale：应用按 Accept-Language 选择语言包，E2E 断言基于中文文案
    locale: "zh-CN",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 每条用例独立登录，套件本身会打出十几次匿名请求（/api/auth/* 均走 anon
    // 档 20/min）——达到档位后 login 直接 429，用例表现为"登录失败"。与 CI
    // integration 任务一致，给 E2E 的 server 抬高限额；限流档位本身由 smoke
    // 的 limits 组断言，不靠这里覆盖。
    env: {
      RATE_LIMIT_PER_MIN: "2000",
      RATE_LIMIT_ANON_PER_MIN: "1000",
      RATE_LIMIT_KB_PER_MIN: "2000",
      RATE_LIMIT_KEY_PER_MIN: "5000",
      RATE_LIMIT_AGENT_PER_MIN: "60",
    },
  },
});
