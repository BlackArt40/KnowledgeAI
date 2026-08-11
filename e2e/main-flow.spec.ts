// P6-3 E2E: 关键用户流程（登录 → 上传 → 问答 → Agent）。
// 运行: pnpm test:e2e（playwright.config 自动拉起 pnpm dev）
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "owner@knowledgeai.dev";
const PASSWORD = "password123";

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
  await page.locator("textarea").fill(question);
  await page.locator("textarea").press("Enter");

  // 用户气泡出现
  await expect(page.getByText(question).first()).toBeVisible({ timeout: 15_000 });
  // 助手回答出现（抽取式或检索不到提示，均为回答气泡）
  await expect(page.locator(".bg-muted").first()).toBeVisible({ timeout: 30_000 });
});

test("Agent：创建调研任务并完成报告", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "开始调研" })).toBeVisible({ timeout: 90_000 });
  // 调研结果报告出现（demo 模式生成 Markdown 报告）
  await expect(page.getByText("调研结果").first()).toBeVisible({ timeout: 30_000 });
});
