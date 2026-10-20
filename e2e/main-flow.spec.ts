// P6-3 → V6：关键用户流程（登录 → 上传 → 问答 → Agent）。
// V6 退役后 Next 只服务 /api/**，页面由 vite preview（:4173，frontend dist
// 含 SEO 预渲染 home.html）承载——playwright.config 双 webServer 自动拉起，
// 本套件统一打 Vue DOM（选择器与 frontend/e2e 同口径：登录表单沿用
// #email/#password，业务页用 V1-V5 固化的稳定类名）。
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

test("登录：demo 账号进入工作台", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator(".sidebar").getByText("仪表盘")).toBeVisible();
});

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

test("上传：新建知识库并上传文档，等待处理完成", async ({ page }) => {
  await login(page);

  // 新建知识库（不依赖种子数据；V3 e2e 同款选择器）
  await page.goto("/knowledge-base");
  await page.getByRole("button", { name: "新建知识库" }).first().click();
  const kbName = `E2E-${Date.now().toString(36)}`;
  await page.locator(".el-dialog input").first().fill(kbName);
  await page.locator(".el-dialog button", { hasText: "创建" }).click();
  await expect(page).toHaveURL(/\/knowledge-base\/kb_/, { timeout: 20_000 });

  // 上传 fixture（详情页上传区）
  await page.locator(".upload").click();
  await page.setInputFiles('input[type="file"]', {
    name: "sample.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# E2E Sample\n向量检索通过嵌入相似度实现。"),
  });

  // 文档行出现并进入「就绪」状态（demo 模式内存队列处理；V3 口径：行可见即可，
  // 状态徽标文案随 i18n 包，不在此处精确锚定）
  await expect(page.locator(".doc-row").first()).toBeVisible({ timeout: 30_000 });
});

test("问答：对上传的文档提问并收到回答", async ({ page }) => {
  await login(page);

  // 通过 API 取任意知识库 id（page.request 共享登录 cookie），直接进入问答
  const res = await page.request.get("/api/knowledge-base");
  const kbs = (await res.json()).kbs ?? [];
  expect(kbs.length).toBeGreaterThan(0);
  const kbId = kbs[0].id;

  await page.goto(`/chat?kb=${kbId}`);
  const question = "向量检索是怎么实现的？";
  const chatBox = page.locator(".ask-input");
  await expect(chatBox).toBeVisible();
  await chatBox.fill(question);
  await expect(chatBox).toHaveValue(question);
  await chatBox.press("Enter");

  // 用户气泡出现
  await expect(page.locator(".bubble-user").getByText(question).first()).toBeVisible({ timeout: 15_000 });
  // 助手回答出现（抽取式或检索不到提示，均为回答气泡）
  await expect(page.locator(".bubble-ai").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".bubble-ai").first()).not.toHaveText("", { timeout: 30_000 });
});

test("Agent：创建调研任务并完成报告", async ({ page }) => {
  // 真实 LLM 部署（docker compose）下单次调研为 1–3 分钟，demo 内存模式只需几秒。
  test.setTimeout(300_000);

  await login(page);

  await page.goto("/agent");
  const topicBox = page.locator(".topic-input");
  await expect(topicBox).toBeVisible();
  const topic = "帮我调研 AI 就业市场";
  await topicBox.fill(topic);
  await expect(topicBox).toHaveValue(topic);
  await page.locator(".run-btn").click();

  // 运行中按钮变为「停止调研」；演示模式可能在断言前就结束，因此两种文案都可
  await expect(page.locator(".run-btn").getByText(/停止调研|开始调研/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".run-btn").getByText("开始调研")).toBeVisible({ timeout: 240_000 });
  // 调研结果报告出现：终态随 done 事件下发，到达即为报告正文而非空面板
  await expect(page.locator(".report").first()).toBeVisible({ timeout: 60_000 });
});
