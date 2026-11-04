// P3 Phase 2c：两个会话同开一篇文档，A 输入 → B 在数秒内看到（Yjs over SSE+POST）。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test("协同编辑：两个会话实时同步同一篇文档", async ({ browser }) => {
  test.setTimeout(90_000);
  const aCtx = await browser.newContext();
  const a = await aCtx.newPage();
  await login(a, OWNER);

  const kbRes = await a.request.post("/api/knowledge-base", {
    data: { name: `Collab E2E ${Date.now()}`, desc: "" },
  });
  const kbId = ((await kbRes.json()) as { kb?: { id: string } }).kb?.id;
  expect(kbId).toBeTruthy();
  const uploadRes = await a.request.post(`/api/knowledge-base/${kbId}/upload`, {
    multipart: {
      files: {
        name: "collab-e2e.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# 协同\n初始文本"),
      },
    },
  });
  expect(uploadRes.ok()).toBeTruthy();

  const openEditor = async (page: Page) => {
    await page.goto(`/knowledge-base/${kbId}`);
    const row = page.locator(".doc-row").filter({ hasText: "collab-e2e.md" });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /编辑正文|查看/ }).click();
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
  };

  try {
    await openEditor(a);

    const bCtx = await browser.newContext();
    const b = await bCtx.newPage();
    await login(b, OWNER);
    await openEditor(b);

    // A 输入 → B 收到远端 update（SSE doc_yjs）
    await a.locator(".cm-content").click();
    await a.keyboard.press("ControlOrMeta+End");
    await a.keyboard.type(" SYNC-A");
    await expect(b.locator(".cm-content")).toContainText("SYNC-A", { timeout: 10_000 });

    // 反向：B 输入 → A 也收到
    await b.locator(".cm-content").click();
    await b.keyboard.press("ControlOrMeta+End");
    await b.keyboard.type(" SYNC-B");
    await expect(a.locator(".cm-content")).toContainText("SYNC-B", { timeout: 10_000 });

    await bCtx.close();
  } finally {
    await a.request.delete(`/api/knowledge-base/${kbId}`).catch(() => {});
    await aCtx.close();
  }
});
