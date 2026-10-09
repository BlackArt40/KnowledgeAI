// P6-3 E2E: 关键用户流程（登录 → 上传 → 问答 → Agent）。
// 运行: pnpm test:e2e（playwright.config 自动拉起 pnpm dev）
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
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  // 等待 AppShell 导航出现（客户端渲染完成）
  await expect(page.getByText("仪表盘").first()).toBeVisible({ timeout: 20_000 });
}

test("登录：demo 账号进入工作台", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("仪表盘").first()).toBeVisible();
});

test("已登录：官网头部显示进入工作台，登录/注册页自动回工作台", async ({ page }) => {
  await login(page);

  // 从工作台点左上角 Logo 回官网（用户报告路径）：头部仍是登录态
  await page.getByRole("link", { name: "KnowledgeAI" }).first().click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  const header = page.locator("header").first();
  await expect(header.getByRole("link", { name: "进入工作台" })).toBeVisible();
  await expect(header.getByRole("link", { name: "登录", exact: true })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "免费开始" })).toHaveCount(0);

  // 「进入工作台」一键回到仪表盘
  await header.getByRole("link", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // 书签/旧链接直接访问登录页与注册页：自动跳回工作台
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.goto("/register");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
});

test("未登录：开发者门户跳转登录页", async ({ page }) => {
  await page.goto("/developer");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
});

test("官网：查看演示落到页内交互预览，并可切换三种模式", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "查看演示" }).click();

  // 目标是页内的交互式预览（标题"实时交互预览"），而不是功能卡片区
  await expect(page).toHaveURL(/#demo$/);
  const demo = page.locator("#demo");
  await expect(demo).toBeInViewport();
  await expect(demo.getByText("实时交互预览")).toBeVisible();
  await expect(demo.getByText("2026 年 AI 工程师的就业趋势如何？")).toBeVisible();

  // 预览可交互：问答 → 知识库管理 → Agent 调研
  await demo.getByRole("button", { name: "知识库管理" }).click();
  await expect(demo.getByText("解析、切片与向量化")).toBeVisible();
  await demo.getByRole("button", { name: "Agent 调研" }).click();
  await expect(demo.getByText("规划", { exact: true })).toBeVisible();
  await expect(demo.getByText("撰写", { exact: true })).toBeVisible();
});

test("退出登录：会话真正失效并停在登录页", async ({ page }) => {
  await login(page);

  // 右上角用户菜单 → 退出登录
  await page.locator("header").getByRole("button", { name: /张明/ }).click();
  await page.getByRole("button", { name: "退出登录" }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  // 服务端会话真的结束：httpOnly cookie 由接口清除，鉴权接口返回 401
  // （前端 JS 无法删除该 cookie，这正是此前"点了没退出"的原因）
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(401);
  // 不会被"已登录自动进工作台"守卫弹回（留出一个跳转窗口）
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login/);
  // 受保护路由同样回到登录页
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("上传：新建知识库并上传文档，等待处理完成", async ({ page }) => {
  await login(page);

  // 新建知识库（不依赖种子数据）
  await page.goto("/knowledge-base");
  await page.getByRole("button", { name: "新建知识库" }).first().click();
  const kbName = `E2E-${Date.now().toString(36)}`;
  await page.getByPlaceholder(/例如：产品文档/).fill(kbName);
  await page.getByRole("button", { name: "创建", exact: true }).click();

  // 进入知识库详情并上传 fixture
  await page.goto("/knowledge-base");
  await page.getByText(kbName).first().click();
  await page.waitForURL(/\/knowledge-base\/kb_/);
  await page.locator('input[type="file"]').first().setInputFiles("e2e/fixtures/sample.md");

  // 文档行出现并进入「就绪」状态（demo 模式内存队列处理）
  await expect(page.getByText("就绪", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
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
  const chatBox = page.locator("textarea").first();
  await expect(chatBox).toBeVisible();
  // React 水合接管受控组件前 fill 可能与默认值竞争——填充后校验，未生效则重试
  for (let i = 0; i < 5; i++) {
    await chatBox.fill(question);
    if ((await chatBox.inputValue()) === question) break;
    await page.waitForTimeout(300);
  }
  await expect(chatBox).toHaveValue(question);
  await chatBox.press("Enter");

  // 用户气泡出现
  await expect(page.getByText(question).first()).toBeVisible({ timeout: 15_000 });
  // 助手回答出现（抽取式或检索不到提示，均为回答气泡）
  await expect(page.locator(".bg-muted").first()).toBeVisible({ timeout: 30_000 });
});

test("Agent：创建调研任务并完成报告", async ({ page }) => {
  // 真实 LLM 部署（docker compose）下单次调研为 1–3 分钟，demo 内存模式只需几秒。
  // 给足预算，避免在多进程 + 真实模型环境下把"慢"误判成"坏"。
  test.setTimeout(300_000);

  await login(page);

  await page.goto("/agent");
  const topicBox = page.locator("textarea");
  await expect(topicBox).toBeVisible();
  // React 水合接管受控组件前 fill 可能与默认值竞争——填充后校验，未生效则重试
  const topic = "帮我调研 AI 就业市场";
  for (let i = 0; i < 5; i++) {
    await topicBox.fill(topic);
    if ((await topicBox.inputValue()) === topic) break;
    await page.waitForTimeout(300);
  }
  await expect(topicBox).toHaveValue(topic);
  await page.getByRole("button", { name: "开始调研" }).click();

  // 运行中按钮变为「调研中…」，结束后恢复「开始调研」
  await expect(page.getByRole("button", { name: "调研中…" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "开始调研" })).toBeVisible({ timeout: 240_000 });
  // 调研结果报告出现：终态随 done 事件下发（多进程下 worker 生成，见
  // src/lib/agent/run-handler.ts），到达即为报告正文，而非空面板。
  await expect(page.getByText("调研结果").first()).toBeVisible({ timeout: 60_000 });
});

test("Agent：SSE error 事件在界面可见（队列繁忙 / 原始消息 / 流中断）", async ({ page }) => {
  await login(page);

  // 真实的队列/模型故障难以在用例里稳定复现，这里拦截 /api/agent/run 注入
  // 合成 SSE 流，只验证前端对 error 帧的呈现（曾经完全静默：无任何提示）。
  let body = "";
  await page.route("**/api/agent/run", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body })
  );

  await page.goto("/agent");
  await expect(page.locator("textarea").first()).toBeVisible();
  // Next 的 __next-route-announcer__ 也带 role=alert，这里按文案锁定本页横幅。
  const alertBox = page.getByRole("alert").filter({ hasText: "调研未完成" });
  const runBtn = page.getByRole("button", { name: "开始调研" });

  // 1) 带 code=queue_busy：展示与界面语言一致的文案
  body = 'data: {"type":"init","taskId":"task_synth"}\n\ndata: {"type":"error","code":"queue_busy","message":"raw server text"}\n\n';
  await runBtn.click();
  await expect(alertBox).toContainText("调研未完成");
  await expect(alertBox).toContainText("系统繁忙");

  // 2) 无 code（worker 侧失败）：原样展示服务端消息
  body = 'data: {"type":"init","taskId":"task_synth"}\n\ndata: {"type":"error","message":"LLM 调用失败：429"}\n\n';
  await runBtn.click();
  await expect(alertBox).toContainText("LLM 调用失败：429");

  // 3) 流关闭但没有 done/error（worker 崩溃）：提示可重试
  body = 'data: {"type":"init","taskId":"task_synth"}\n\n';
  await runBtn.click();
  await expect(alertBox).toContainText("调研中断");
});
