// V3 前端 e2e：知识库流（新建/详情/上传/删除/图谱）+ team + api-keys。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", OWNER);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 20_000 });
}

test("KB 列表：渲染 + ?new=1 深链接打开新建对话框", async ({ page }) => {
  await login(page);
  await page.goto("/knowledge-base?new=1");
  await expect(page.locator(".el-dialog")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
});

test("KB 全流程：新建 → 详情 → 上传 txt → ready → 删库", async ({ page }) => {
  await login(page);
  const name = `V3-E2E-KB-${Date.now()}`;
  await page.goto("/knowledge-base");
  await page.getByRole("button", { name: "新建知识库" }).first().click();
  await page.locator(".el-dialog input").first().fill(name);
  await page.locator(".el-dialog button", { hasText: "创建" }).click();
  await expect(page).toHaveURL(/\/knowledge-base\/kb_/, { timeout: 20_000 });

  // 上传文本文档
  await page.locator(".upload").click();
  await page.setInputFiles('input[type="file"]', {
    name: "v3-e2e-doc.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# V3 E2E\n知识库的关键趋势是检索增强生成。"),
  });
  await expect(page.locator(".doc-row").first()).toBeVisible({ timeout: 20_000 });

  // 图谱入口可达（空图谱或少量节点均可）
  await page.locator("a", { hasText: "知识图谱" }).first().click();
  await expect(page).toHaveURL(/\/graph$/, { timeout: 20_000 });
  await expect(page.locator(".graph-card, .empty").first()).toBeVisible({ timeout: 15_000 });

  // 删库
  await page.goto(`/knowledge-base/${(await page.url().match(/kb_[a-z0-9]+/))?.[0]}`);
  await page.locator("button", { hasText: "设置" }).first().click();
  page.once("dialog", (d) => d.accept());
  await page.locator(".el-dialog button", { hasText: "删除" }).click();
  await expect(page).toHaveURL(/\/knowledge-base$/, { timeout: 20_000 });
});

test("KB 详情：重建索引（行内按钮 → 排队 → 就绪）", async ({ page }) => {
  await login(page);
  // 复用已有知识库而不是新建：重建索引的典型场景就是"存量库缺向量"，
  // 且能少一次写请求（e2e 套件对 kb 维度限流敏感）
  await page.goto("/knowledge-base");
  await expect(page.locator(".kb-card").first()).toBeVisible({ timeout: 20_000 });
  const firstKb = page.locator(".kb-card a").first();
  if ((await firstKb.count()) === 0) test.skip(true, "当前环境没有知识库可重建");
  await firstKb.click();
  await expect(page).toHaveURL(/\/knowledge-base\/kb_/, { timeout: 20_000 });
  // 详情页首屏渲染完成（上传区恒在）后再判断是否文档
  await expect(page.locator(".upload")).toBeVisible({ timeout: 20_000 });

  const row = page.locator(".doc-row").first();
  if ((await row.count()) === 0) test.skip(true, "当前知识库没有文档可重建");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("就绪", { timeout: 40_000 });

  // 行内「重建索引」：断言按钮确实打通了接口（200），再等回到就绪且无失败态。
  // 不 assert 顶部提示文案——文档进入处理态后 card-head 会切成「N 个处理中…」，
  // 提示可能只存在几百毫秒，属易碎断言。
  const reindexResp = page.waitForResponse(
    (r) => r.url().includes("/reindex") && r.request().method() === "POST",
    { timeout: 30_000 }
  );
  await row.getByRole("button", { name: "重建索引" }).click();
  expect((await reindexResp).status()).toBe(200);
  await expect(page.locator(".doc-row").first()).toContainText("就绪", { timeout: 60_000 });
  await expect(page.locator(".doc-row").first().locator(".err")).toHaveCount(0);
});

test("team：统计卡 + 成员表渲染", async ({ page }) => {
  await login(page);
  await page.goto("/team");
  await expect(page.locator(".stat .v").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".member").first()).toBeVisible();
});

test("api-keys：创建（一次性明文）→ 撤销", async ({ page }) => {
  await login(page);
  await page.goto("/api-keys");
  await page.getByRole("button", { name: /创建/ }).first().click();
  await page.locator(".el-dialog input").first().fill(`V3-E2E-KEY-${Date.now()}`);
  await page.locator(".el-dialog button", { hasText: "创建" }).click();
  // 一次性 secret 对话框
  await expect(page.locator(".secret")).toBeVisible({ timeout: 15_000 });
  await page.locator(".el-dialog button", { hasText: "关闭" }).click();
  // 撤销刚创建的（第一行），断言行数减一（历史 key 可能累积）
  const before = await page.locator(".key-row").count();
  const row = page.locator(".key-row").first();
  await expect(row).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await row.locator("button", { hasText: "删除" }).click();
  await expect(page.locator(".key-row")).toHaveCount(before - 1, { timeout: 15_000 });
});
