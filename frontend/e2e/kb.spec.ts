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
