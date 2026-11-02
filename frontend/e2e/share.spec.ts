// 共享与分发（P4-2 回归 + 库级链接）：owner 生成库链接 → 匿名窗口只读访问；
// 文档级链接入口（V6 丢失的 DocShareDialog）恢复可用。
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

test("共享：库链接匿名只读 + 文档链接入口", async ({ page, browser }) => {
  await login(page);
  const name = `E2E 分享 ${Date.now()}`;
  await page.goto("/knowledge-base?new=1");
  await page.locator(".el-dialog input").first().fill(name);
  await page.locator(".el-dialog button", { hasText: "创建" }).click();
  await expect(page).toHaveURL(/\/knowledge-base\/kb_/, { timeout: 20_000 });
  const kbId = page.url().match(/kb_[a-z0-9]+/)?.[0];
  expect(kbId).toBeTruthy();

  try {
    await page.locator(".upload").click();
    await page.setInputFiles('input[type="file"]', {
      name: "share-e2e.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 分享\n共享与分发验证"),
    });
    const row = page.locator(".doc-row").filter({ hasText: "share-e2e.md" });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // ① 库级链接：生成 → 复制框里拿到 /share-kb/ks_*
    await page.getByRole("button", { name: "分享", exact: true }).click();
    const kbDialog = page.locator(".el-dialog").filter({ hasText: "分享知识库" });
    await expect(kbDialog).toBeVisible();
    await kbDialog.getByRole("button", { name: "生成分享链接" }).click();
    const kbUrl = await kbDialog.locator('[data-testid="share-url"]').textContent({ timeout: 15_000 });
    expect(kbUrl).toContain("/share-kb/ks_");

    // ② 匿名访问：公开页渲染库名与文档，点开可看正文预览
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto(kbUrl!);
    await expect(anon.getByRole("heading", { name })).toBeVisible({ timeout: 20_000 });
    const anonRow = anon.locator(".doc-item").filter({ hasText: "share-e2e.md" });
    await expect(anonRow).toBeVisible();
    await anonRow.locator(".doc-head").click();
    await expect(anonRow.locator(".doc-preview")).toBeVisible({ timeout: 15_000 });
    await anonCtx.close();

    // ③ 文档级链接入口（V6 迁移时丢失的分享按钮）
    await kbDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await row.getByRole("button", { name: "分享文档" }).click();
    const docDialog = page.locator(".el-dialog").filter({ hasText: "分享文档" });
    await expect(docDialog).toBeVisible();
    await docDialog.getByRole("button", { name: "生成分享链接" }).click();
    const docUrl = await docDialog.locator('[data-testid="share-url"]').textContent({ timeout: 15_000 });
    expect(docUrl).toContain("/share-doc/sh_");
  } finally {
    await page.request.delete(`/api/knowledge-base/${kbId}`).catch(() => {});
  }
});
