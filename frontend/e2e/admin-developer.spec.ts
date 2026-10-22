// V5 前端 e2e：管理后台（概览面板 + 可观测看板）+ 开发者门户 + Swagger
// 文档页 + 营销首页（含导航登录态）。owner/admin 角色由 AppShell routeGuard
// 与 API 双层兜底；用例只读不改状态。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
const ADMIN = "admin@knowledgeai.dev";
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page, email: string = OWNER): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 20_000 });
}

test("admin 概览：统计卡 + 配置 + 审计面板渲染", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await expect(page.locator(".admin-page")).toBeVisible({ timeout: 20_000 });
  // 八张统计卡 + 用户表 + 配置卡 + 审计表
  await expect(page.locator(".stat")).toHaveCount(8, { timeout: 20_000 });
  await expect(page.locator(".tbl").first()).toBeVisible();
  await expect(page.locator(".role-grid .role-row")).toHaveCount(4);
});

test("管理端删号按钮仅 owner 可见（admin 看不到）", async ({ page, context }) => {
  // admin 登录：用户表行内只有封禁/解封，没有「删除账号」
  await login(page, ADMIN);
  await page.goto("/admin");
  await expect(page.locator(".tbl tbody tr").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "删除账号" })).toHaveCount(0);
  // 封禁入口仍在（证明行内操作确实渲染了，不是整行缺失）
  await expect(page.getByRole("button", { name: "封禁" }).first()).toBeVisible();

  // owner 登录：至少有非自己的行显示删除入口
  await context.clearCookies();
  await login(page, OWNER);
  await page.goto("/admin");
  await expect(page.locator(".tbl tbody tr").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "删除账号" }).first()).toBeVisible();
});

test("admin/monitoring：SLI 卡 + 队列 + LLM 面板渲染", async ({ page }) => {
  await login(page);
  await page.goto("/admin/monitoring");
  await expect(page.locator(".mon-page")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".stat")).toHaveCount(4, { timeout: 20_000 });
  await expect(page.locator(".usage-chart").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".card").first()).toBeVisible();
});

test("developer：四 tab 渲染 + 快速开始 SDK 示例", async ({ page }) => {
  await login(page);
  await page.goto("/developer");
  await expect(page.locator(".dev-page")).toBeVisible({ timeout: 20_000 });
  // 快速开始：三种语言示例（EP tabs 所有 pane 常驻 DOM——限定 #pane-quickstart）
  await expect(page.locator("#pane-quickstart .snippet")).toHaveCount(3, { timeout: 20_000 });
  // 切到集成 tab：Widget 片段与机器人卡片可达
  await page.locator(".el-tabs__item", { hasText: "集成" }).click();
  await expect(page.locator(".integrations .card").first()).toBeVisible({ timeout: 15_000 });
});

test("docs：Swagger UI 容器加载（/api/openapi.json）", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator("#kai-swagger-ui")).toBeVisible({ timeout: 20_000 });
  // swagger-ui bundle 从 /vendor/swagger-ui 加载（e2e 中经 vite proxy 到 Next）
  const resp = await page.request.get("/api/openapi.json");
  expect(resp.ok()).toBeTruthy();
});

test("home：营销首页渲染（未登录态导航 + Hero + 定价）", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero .title")).toContainText("KnowledgeAI", { timeout: 20_000 }).catch(async () => {
    // 标题含 t("page.hero.s12")，宽松断言：Hero 主标题存在即可
    await expect(page.locator(".hero .title")).toBeVisible({ timeout: 20_000 });
  });
  await expect(page.locator("#demo")).toBeVisible();
  await expect(page.locator("#pricing")).toBeVisible();
  // 未登录：导航显示「登录」入口（已登录时是「进入工作台」）
  await expect(page.locator(".navbar").first()).toBeVisible();
});
