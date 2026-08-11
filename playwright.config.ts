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
  },
});
