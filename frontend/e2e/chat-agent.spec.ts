// V4 前端 e2e：SSE 事件名契约断言（sources/token/done 与 init/step/done/error
// 冻结不变）+ 对话流（深链接 ?kb= → 发问 → 回复 → 会话入列）+ Agent 调研流
// （运行 → 报告 → ?task= 深链接）+ 账务（billing 渲染 → checkout 支付成功）。
// 用例自建自清（API 直建 KB/任务），顺序无关。
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

test("SSE 契约：/api/chat 事件名 sources/token/done 不变", async ({ page }) => {
  await login(page);
  const kbRes = await page.request.post("/api/knowledge-base", { data: { name: `V4-SSE-${Date.now()}` } });
  const kbId = ((await kbRes.json()) as { kb: { id: string } }).kb.id;
  try {
    const res = await page.request.post("/api/chat", { data: { kbId, query: "演示问题：这个知识库能做什么？" } });
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain('"type":"sources"');
    expect(text).toContain('"type":"token"');
    expect(text).toContain('"type":"done"');
  } finally {
    // 清理会话与 KB
    const convs = await page.request.get(`/api/chat/conversations?kbId=${kbId}`);
    for (const c of ((await convs.json()) as { conversations?: { id: string }[] }).conversations ?? []) {
      await page.request.delete(`/api/chat/conversations/${c.id}`);
    }
    await page.request.delete(`/api/knowledge-base/${kbId}`);
  }
});

test("SSE 契约：/api/agent/run 事件名 init/step/done 不变", async ({ page }) => {
  await login(page);
  const res = await page.request.post("/api/agent/run", { data: { topic: "V4 SSE 契约验证" } });
  expect(res.ok()).toBeTruthy();
  const text = await res.text();
  expect(text).toContain('"type":"init"');
  expect(text).toContain('"type":"step"');
  expect(text).toContain('"type":"done"');
  // 清理本次任务
  const tasks = await page.request.get("/api/agent/tasks");
  for (const tk of ((await tasks.json()) as { tasks?: { id: string; topic: string }[] }).tasks ?? []) {
    if (tk.topic === "V4 SSE 契约验证") await page.request.delete(`/api/agent/tasks/${tk.id}`);
  }
});

test("chat 全流程：?kb= 深链接 → 发问 → 流式回复 → 会话入列 → 清理", async ({ page }) => {
  await login(page);
  const kbRes = await page.request.post("/api/knowledge-base", { data: { name: `V4-CHAT-${Date.now()}` } });
  const kbId = ((await kbRes.json()) as { kb: { id: string } }).kb.id;
  try {
    // 深链接进入并预选 KB
    await page.goto(`/chat?kb=${kbId}`);
    await expect(page.locator(".chat-page")).toBeVisible({ timeout: 20_000 });
    await page.locator(".ask-input").fill("知识库的关键趋势是什么？");
    await page.locator(".send-btn").click();
    // 助手气泡出现且流式完成后有正文（demo 抽取式生成即时返回）
    await expect(page.locator(".bubble-ai").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".bubble-ai").first()).not.toHaveText("", { timeout: 20_000 });
    // 会话保存后进入侧栏
    await expect(page.locator(".conv-side .item").first()).toBeVisible({ timeout: 20_000 });
  } finally {
    const convs = await page.request.get(`/api/chat/conversations?kbId=${kbId}`);
    for (const c of ((await convs.json()) as { conversations?: { id: string }[] }).conversations ?? []) {
      await page.request.delete(`/api/chat/conversations/${c.id}`);
    }
    await page.request.delete(`/api/knowledge-base/${kbId}`);
  }
});

test("agent 全流程：运行 → 报告渲染 → ?task= 深链接 → 清理", async ({ page }) => {
  await login(page);
  await page.goto("/agent");
  await expect(page.locator(".agent-page")).toBeVisible({ timeout: 20_000 });
  const topic = `V4-E2E-调研-${Date.now()}`;
  await page.locator(".topic-input").fill(topic);
  await page.locator(".run-btn").click();
  // 运行反馈：真实 LLM 模式先见时间线（steps 渐进）；demo（CI）模式编排
  // 秒级完成且 done 后 task.steps 为空 → timeline 隐藏、直接切报告视图。
  // 等「时间线或报告」任一出现，双模式通用。
  await expect(page.locator(".timeline, .report").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".report").first()).toBeVisible({ timeout: 30_000 });
  // 历史任务侧栏出现本次任务，深链接打开
  const tasks = await page.request.get("/api/agent/tasks");
  const list = ((await tasks.json()) as { tasks?: { id: string; topic: string }[] }).tasks ?? [];
  const created = list.find((tk) => tk.topic === topic);
  expect(created).toBeTruthy();
  await page.goto(`/agent?task=${created!.id}`);
  await expect(page.locator(".report").first()).toBeVisible({ timeout: 20_000 });
  await page.request.delete(`/api/agent/tasks/${created!.id}`);
});

test("billing：套餐卡/对比表/账单渲染", async ({ page }) => {
  await login(page);
  await page.goto("/billing");
  await expect(page.locator(".plan-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".cmp")).toBeVisible();
  await expect(page.locator(".inv, .inv-list").first()).toBeVisible();
});

test("checkout：?plan= 深链接 → 模拟支付 → 成功态", async ({ page }) => {
  await login(page);
  await page.goto("/checkout?plan=pro");
  await expect(page.locator(".summary")).toBeVisible({ timeout: 20_000 });
  await page.locator(".pay-btn").click();
  await expect(page.locator(".state-ava.success")).toBeVisible({ timeout: 30_000 });
  // 状态还原：取消 + 恢复订阅（保持 active，演示态不留悬挂取消标记）
  await page.request.post("/api/billing/cancel", { data: { action: "cancel" } });
  await page.request.post("/api/billing/cancel", { data: { action: "resume" } });
});
