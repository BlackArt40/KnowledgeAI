// viewer 只读回归（配合 #83/#86 的权限收口）：
// ① 报告页不出现 编辑 / 分享设置 / 恢复 入口；
// ② 评论对 viewer 开放：可发表、自己的评论可见。
// 服务端 403 行为已由 route-access 单测覆盖，这里只锁 UI 可见性。
import { expect, test, type Page } from "@playwright/test";

const OWNER = "owner@knowledgeai.dev";
const VIEWER = "viewer@knowledgeai.dev";
const PASSWORD = String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51);

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test("viewer：报告只读入口隐藏，评论可参与", async ({ browser }) => {
  // 带 KB + 单 writer Agent 跑 demo 调研（跳过外部检索与多步动画）；
  // 本机 dev 下仍需 ~50s，给 120s 预算。不带 KB 会走外部搜索，更慢。
  test.setTimeout(120_000);
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, OWNER);

  const kbRes = await owner.request.post("/api/knowledge-base", {
    data: { name: `E2E viewer ${Date.now()}` },
  });
  const kbId = ((await kbRes.json()) as { kb?: { id: string } }).kb?.id;
  expect(kbId).toBeTruthy();

  // 清掉历史遗留的排队/进行中任务：agent 队列串行，遗留任务会把本次运行
  // 压到 120s 预算之外（本地 dev 一次运行 ~50s）。
  const stale = (await (await owner.request.get("/api/agent/tasks")).json()) as {
    tasks?: Array<{ id: string; status: string }>;
  };
  for (const t of stale.tasks ?? []) {
    if (t.status === "queued" || t.status === "running") {
      await owner.request.delete(`/api/agent/tasks/${t.id}`).catch(() => {});
    }
  }

  // 用 SSE 起 demo 调研任务，读到 done 事件拿 taskId
  const taskId = await owner.evaluate(async (kbId) => {
    const res = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "E2E viewer 只读回归", kbId, agents: ["writer"], maxSteps: 1 }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const doneLine = buf
        .split("\n")
        .find((l) => l.startsWith("data:") && l.includes('"type":"done"'));
      if (doneLine) return (JSON.parse(doneLine.slice(5).trim()).task as { id: string })?.id;
    }
    return null;
  }, kbId);
  expect(taskId).toBeTruthy();

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await login(viewer, VIEWER);
  await viewer.goto(`/agent?task=${taskId}`);

  // 报告已生成（v1 自动保存 → 版本 tab 出现）
  await expect(viewer.getByRole("tab", { name: /版本/ })).toBeVisible({ timeout: 20_000 });

  // ① 只读：编辑 / 分享设置 / 恢复 均不渲染
  await expect(viewer.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "分享设置", exact: true })).toHaveCount(0);
  await viewer.getByRole("tab", { name: /版本/ }).click();
  await expect(viewer.getByRole("button", { name: "恢复", exact: true })).toHaveCount(0);

  // ② 讨论开放：切到评论 tab，viewer 可发表评论
  await viewer.getByRole("tab", { name: /评论/ }).click();
  const comment = `viewer e2e 评论 ${Date.now()}`;
  await viewer.locator("textarea.cn-input").fill(comment);
  await viewer.getByRole("button", { name: "发表", exact: true }).click();
  await expect(viewer.locator(".comment").filter({ hasText: comment })).toBeVisible({
    timeout: 15_000,
  });

  // 清理：owner 删除任务与临时 KB
  await owner.request.delete(`/api/agent/tasks/${taskId}`).catch(() => {});
  await owner.request.delete(`/api/knowledge-base/${kbId}`).catch(() => {});
  await ownerCtx.close();
  await viewerCtx.close();
});
