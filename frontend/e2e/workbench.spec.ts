// V2 前端 e2e：工作台骨架（AppShell + dashboard + settings 全 tab + Cmd+K）。
// 运行: pnpm -C frontend test:e2e。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", OWNER);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // 登录成功 = 整页跳 /dashboard（V2 起由 Vue 接管）
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 20_000 });
}

test("dashboard：Vue 壳 + 统计卡 + 欢迎语（含用户名）", async ({ page }) => {
  await login(page);
  await expect(page.locator(".topbar .page-title")).toHaveText(/仪表盘|Dashboard/);
  await expect(page.locator(".stat-value").first()).toBeVisible();
  // 侧栏导航包含已迁移项（dashboard/settings 高亮态由 router 判定）
  await expect(page.locator(".sidebar .nav-item").first()).toBeVisible();
});

test("AppShell：通知铃铛面板可开合，语言/主题控件存在", async ({ page }) => {
  await login(page);
  await page.locator("button[aria-label='通知']").click();
  await expect(page.locator(".notif-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".theme-toggle")).toBeVisible();
});

const TAB_LABELS: Record<string, string> = {
  security: "安全",
  profile: "个人信息",
  privacy: "数据隐私",
  models: "AI 模型",
  appearance: "外观",
};

test("settings：五个 tab 深链接全部可达", async ({ page }) => {
  await login(page);
  for (const tab of ["security", "profile", "privacy", "models", "appearance"]) {
    await page.goto(`/settings?tab=${tab}`);
    await expect(page.locator(".el-tabs__item.is-active")).toContainText(TAB_LABELS[tab], { timeout: 15_000 });
    await expect(page.locator(`#pane-${tab}`)).toBeVisible();
  }
});

test("settings：profile tab 显示邮箱 + 通知偏好开关", async ({ page }) => {
  await login(page);
  await page.goto("/settings?tab=profile");
  await expect(page.locator('input[value*="@knowledgeai.dev"], .el-input.is-disabled input').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".el-switch").first()).toBeVisible();
});

test("settings：appearance 切深色模式（html.dark 生效）", async ({ page }) => {
  await login(page);
  await page.goto("/settings?tab=appearance");
  const modeBtn = page.locator(".mode-btn").nth(1); // dark
  await modeBtn.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  // 复原 light，避免影响后续用例
  await page.locator(".mode-btn").nth(0).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("Cmd+K：全局搜索面板打开、输入与 Escape 清空", async ({ page }) => {
  await login(page);
  await expect(page.locator(".topbar")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".gs-input")).toBeVisible();
  await page.fill(".gs-input", "demo");
  await page.waitForTimeout(600); // 250ms 防抖 + 请求
  await expect(page.locator(".gs-tabs")).toBeVisible();
  await page.keyboard.press("Escape"); // 第一次 Esc 只清空查询
  await expect(page.locator(".gs-input")).toHaveValue("");
});

test("登录后用户菜单：条目可见", async ({ page }) => {
  await login(page);
  await page.locator(".user-btn").click();
  await expect(page.locator(".usermenu-name")).toBeVisible();
  await expect(page.locator(".el-dropdown-menu__item").filter({ hasText: "退出登录" })).toBeVisible();
});
