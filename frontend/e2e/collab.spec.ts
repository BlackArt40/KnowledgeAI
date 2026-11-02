// 协作 / 实时（P4-1）：两个成员同时打开同一个知识库——
// ① 双方都能看到「2 人正在查看」的共览者头像堆叠；
// ② owner 上传文档后，editor 的列表不刷新也能实时出现该文档。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
const EDITOR = "editor@knowledgeai.dev";
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 20_000 });
}

test("协作：两人同看一个知识库，共览者与新增文档实时同步", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const editorCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, OWNER);

  const name = `E2E 协作 ${Date.now()}`;
  await owner.goto("/knowledge-base?new=1");
  await owner.locator(".el-dialog input").first().fill(name);
  await owner.locator(".el-dialog button", { hasText: "创建" }).click();
  await expect(owner).toHaveURL(/\/knowledge-base\/kb_/, { timeout: 20_000 });
  const kbId = owner.url().match(/kb_[a-z0-9]+/)?.[0];
  expect(kbId).toBeTruthy();

  try {
    const editor = await editorCtx.newPage();
    await login(editor, EDITOR);
    await editor.goto(`/knowledge-base/${kbId}`);
    await expect(editor.locator(".upload")).toBeVisible({ timeout: 20_000 });

    // ① 共览者：两个页面都实时显示「2 人正在查看」
    await expect(owner.locator(".viewer-stack")).toHaveAttribute(
      "aria-label",
      /2 人正在查看/,
      { timeout: 20_000 }
    );
    await expect(editor.locator(".viewer-stack")).toHaveAttribute(
      "aria-label",
      /2 人正在查看/,
      { timeout: 20_000 }
    );

    // ② 同一份数据：owner 上传文档，editor 不刷新即可看到
    await owner.locator(".upload").click();
    await owner.setInputFiles('input[type="file"]', {
      name: "collab-e2e.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 协作\n实时同步验证"),
    });
    await expect(owner.locator(".doc-row").filter({ hasText: "collab-e2e.md" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(editor.locator(".doc-row").filter({ hasText: "collab-e2e.md" })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await owner.request.delete(`/api/knowledge-base/${kbId}`).catch(() => {});
    await ownerCtx.close();
    await editorCtx.close();
  }
});

// 可观测与通知：editor 保持工作台页不刷新，owner 改其角色 → 铃铛面板
// 通过 /api/notifications/events 实时插入「团队角色已更新」，证明不是轮询。
test("通知：角色变更经 SSE 实时到达铃铛面板", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const editorCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, OWNER);
  const editor = await editorCtx.newPage();
  await login(editor, EDITOR);

  // 确保通道开启（其他用例可能改过偏好）
  await editor.request.patch("/api/notifications/preferences", {
    data: { teamActivity: true },
  });
  const team = await (await owner.request.get("/api/team")).json();
  const member = team.members.find((m: { email: string }) => m.email === EDITOR);
  expect(member).toBeTruthy();

  try {
    await editor.locator("button[aria-label='通知']").click();
    await expect(editor.locator(".notif-item").first()).toBeVisible();

    const resp = await owner.request.patch(`/api/team/members/${member.id}`, {
      data: { role: "admin" },
    });
    expect(resp.ok()).toBeTruthy();

    await expect(editor.locator(".notif-item").first()).toContainText("团队角色已更新", {
      timeout: 15_000,
    });
  } finally {
    await owner.request.patch(`/api/team/members/${member.id}`, { data: { role: "editor" } }).catch(() => {});
    await ownerCtx.close();
    await editorCtx.close();
  }
});
