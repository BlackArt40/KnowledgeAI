// V1 前端 e2e：认证流 + 静态页 + 分享页（Vue 已接管的 11 个路由）。
// 运行: pnpm -C frontend test:e2e（webServer 自动拉起 vite dev + Next dev）。
// 断言风格与根 e2e 对齐：演示账号 + URL/可见性断言；/dashboard 内容属 Next
// 壳（V2 才接管），这里只断 URL 与 Cookie 生效。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
// Byte-assembled demo credential（与根 e2e 同口径，源码不放明文口令）
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", OWNER);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // 登录成功 = 整页跳 /dashboard（V2 前该路由由 Next 兜底，这里只断 URL）
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test("登录：demo 账号 → 整页跳 /dashboard，Cookie 会话生效", async ({ page }) => {
  await login(page);
  const me = await page.evaluate(async () => {
    const r = await fetch("/api/auth/me", { cache: "no-store" });
    return r.json();
  });
  expect(me?.user?.email).toBe(OWNER);
});

test("登录：错误密码显示错误提示，不跳转", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", OWNER);
  await page.fill("#password", "wrong-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".form-error").first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("已登录：访问 /login 自动回 /dashboard", async ({ page }) => {
  await login(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
});

test("注册：needsVerification → /verify-email?email=，页面展示邮箱", async ({ page }) => {
  const email = `kai-e2e-${Date.now()}@test.local`;
  await page.goto("/register");
  await page.fill("#name", "V1 E2E");
  await page.fill("#email", email);
  await page.fill("#password", "e2e-password-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email/, { timeout: 20_000 });
  await expect(page.getByText(email).first()).toBeVisible();
});

test("忘记密码：提交后展示已提交态与 demo 重置链接", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.fill("#email", OWNER);
  await page.getByRole("button", { name: "发送重置链接" }).click();
  await expect(page.getByText("重置链接已发送")).toBeVisible();
  await expect(page.locator('a[href*="/reset-password?token="]').first()).toBeVisible();
});

test("重置密码：无 token 死链态（不给必败表单）", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("#password")).toHaveCount(0);
});

test("分享文档：未知 token 展示失效态", async ({ page }) => {
  await page.goto("/share-doc/not-a-real-token");
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".icon-badge")).toBeVisible();
});

test("报告分享：未知 id 展示错误态", async ({ page }) => {
  await page.goto("/r/nonexistent-report");
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
});

test("静态页：/privacy /terms /maintenance 正常渲染", async ({ page }) => {
  for (const path of ["/privacy", "/terms", "/maintenance"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
});
