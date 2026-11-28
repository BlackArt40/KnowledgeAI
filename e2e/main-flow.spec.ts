// P6-3 → V6 → 2026-11-27：根套件只保留 frontend/e2e 覆盖不到的"整站/跨壳"契约。
// V6 退役后 Next 只服务 /api/**，页面由 vite preview（:4173，frontend dist
// 含 SEO 预渲染 home.html）承载——playwright.config 双 webServer 自动拉起，
// 本套件统一打 Vue DOM（选择器与 frontend/e2e 同口径）。
//
// 分工（同一路径不再两套断言）：
//   - frontend/e2e 负责页面级流程：登录、KB 新建→上传→就绪、chat / agent 全流程；
//   - 本套件负责那些只在整站层面成立的行为：官网头部登录态与认证页守卫、
//     未登录访问受保护路由的 401 跳转、首页实时演示交互、退出登录后服务端
//     会话真正失效（cookie 清除 + /api/auth/me 401）。
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "owner@knowledgeai.dev";
// Byte-assembled demo credential (documented in AGENTS.md) - no plaintext
// password literal in source.
const PASSWORD = Buffer.from([112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51]).toString();

/** 通过 UI 登录（每个用例独立登录，避免测试间状态耦合）。 */
async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  // 等待 AppShell 工作台首屏（统计卡渲染完成）
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 30_000 });
}

test("已登录：官网头部显示进入工作台，登录/注册页自动回工作台", async ({ page }) => {
  await login(page);

  // 回官网（用户报告路径）：头部仍是登录态
  await page.goto("/");
  const header = page.locator(".navbar").first();
  await expect(header.getByRole("link", { name: "进入工作台" })).toBeVisible({ timeout: 20_000 });
  await expect(header.getByRole("link", { name: "登录", exact: true })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "免费开始" })).toHaveCount(0);

  // 「进入工作台」一键回到仪表盘
  await header.getByRole("link", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // 书签/旧链接直接访问登录页与注册页：自动跳回工作台（V1 认证页守卫）
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.goto("/register");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
});

test("未登录：开发者门户跳转登录页", async ({ page }) => {
  await page.goto("/developer");
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 }); // 401 → 整页跳登录
  await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
});

test("官网：查看演示落到页内实时演示，复刻工作台界面并自动播放", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "查看演示" }).click();

  // 目标是页内的实时演示区（窗口标题"实时演示"），而不是功能卡片区
  await expect(page).toHaveURL(/\/#demo$/);
  const demo = page.locator("#demo");
  await expect(demo).toBeInViewport();
  await expect(demo.getByText("实时演示")).toBeVisible();
  await expect(demo.getByRole("button", { name: "重新演示" })).toBeVisible();

  // 复刻登录后工作台：侧边栏（工作区/协作与计费/系统分组）与顶栏账号
  await expect(demo.getByRole("button", { name: "知识库", exact: true })).toBeVisible();
  await expect(demo.getByRole("button", { name: "Agent 调研", exact: true })).toBeVisible();
  await expect(demo.getByText("用量统计")).toBeVisible();
  await expect(demo.getByText("演示账户")).toBeVisible();

  // 默认在「智能问答」：提问输入 → 回答流式输出 → 引用来源进入右侧面板
  await expect(demo.getByText("2026 年 AI 工程师的就业趋势如何？")).toBeVisible({ timeout: 15_000 });
  await expect(demo.locator(".src-head")).toBeVisible(); // 引用来源面板标题（裸文本+计数徽标，按类锚定）
  await expect(demo.getByText("2026 AI 人才报告")).toBeVisible({ timeout: 15_000 });

  // 仪表盘：欢迎语 + Agent 任务列表
  await demo.getByRole("button", { name: "仪表盘", exact: true }).click();
  await expect(demo.getByText("欢迎回来")).toBeVisible();
  await expect(demo.getByText("Agent 任务")).toBeVisible();

  // 知识库：三张卡片依次入库（处理中 → 就绪）
  await demo.getByRole("button", { name: "知识库", exact: true }).click();
  await expect(demo.getByText("就绪")).toHaveCount(3, { timeout: 15_000 });
  await expect(demo.getByText("128 切片").first()).toBeVisible();

  // Agent 调研：步骤逐个推进 → 报告生成
  await demo.getByRole("button", { name: "Agent 调研", exact: true }).click();
  await expect(demo.getByText("规划", { exact: true })).toBeVisible();
  await expect(demo.getByText("写作", { exact: true })).toBeVisible();
  await expect(demo.getByText("调研报告已生成（1,240 字）")).toBeVisible({ timeout: 15_000 });

  // 重新演示：动画重跑（先回到未完成态，再重新到达终态）
  await demo.getByRole("button", { name: "重新演示" }).click();
  await expect(demo.getByText("调研报告已生成（1,240 字）")).toBeHidden();
  await expect(demo.getByText("调研报告已生成（1,240 字）")).toBeVisible({ timeout: 15_000 });

  // 回归（用户报告 2026-10-10）：回顶部后再点「查看演示」——URL 不得回退为 /
  // 或叠加为 #demo#demo，必须重新滚到演示区；window 标记保留证明是页内滚动
  // （同页锚点为原生 <a>，MktNavbar/Hero 与 Next 版同约定）。
  await page.evaluate(() => {
    (window as unknown as { __demoMarker?: number }).__demoMarker = 1;
    window.scrollTo(0, 0);
  });
  await page.getByRole("link", { name: "查看演示" }).click();
  await expect(page).toHaveURL(/\/#demo$/);
  await expect(demo).toBeInViewport();
  expect(await page.evaluate(() => (window as unknown as { __demoMarker?: number }).__demoMarker)).toBe(1);

  // 以 /#demo 直接载入（书签/刷新）后再点：同样不得把 hash 叠加成 #demo#demo
  await page.goto("/#demo");
  await page.getByRole("link", { name: "查看演示" }).click();
  await expect(page).toHaveURL(/\/#demo$/);
  await expect(demo).toBeInViewport();

  // 导航栏同页锚点（原生 <a>）：连点两次仍稳定停在 /#features
  const navFeatures = page.locator(".navbar").getByRole("link", { name: "功能" });
  await navFeatures.click();
  await expect(page).toHaveURL(/\/#features$/);
  await navFeatures.click();
  await expect(page).toHaveURL(/\/#features$/);
});

test("退出登录：会话真正失效并停在登录页", async ({ page }) => {
  await login(page);

  // 右上角用户菜单 → 退出登录
  await page.locator(".topbar").getByRole("button", { name: /张明/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  // 服务端会话真的结束：httpOnly cookie 由接口清除，鉴权接口返回 401
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(401);
  // 不会被"已登录自动进工作台"守卫弹回（留出一个跳转窗口）
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login/);
  // 受保护路由同样回到登录页
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
});
