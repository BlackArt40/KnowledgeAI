import { expect, test } from "@playwright/test";

// 首页 hero 视觉安全网。
//
// 起因：MktHero 曾用 6 条 `:deep()` 改 KnowledgeConsole / LiveStatus 的内部类名
// （.console / .titlebar / .side / .stage / .live.* ）。把这些覆盖收敛进子组件自有
// 样式后，「渲染结果没变」靠人眼看不出、CI 也没有视觉回归测试，因此在这里锁定
// 最终计算样式：改动前跑绿 → 重构后仍必须跑绿。
//
// 视口取 1440：.side 150px / .stage 330px、14px / .live-row flex-start 三处覆盖
// 都挂在 `@media (min-width: 1180px)`，窄视口看不到。
test.use({ viewport: { width: 1440, height: 900 } });

test.describe("首页 hero 视觉基线", () => {
  test("演示台（KnowledgeConsole）外观锁定", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero .title")).toBeVisible();

    const consoleEl = page.locator(".demo .console");
    await expect(consoleEl).toBeVisible();
    // --radius-xl（hero 覆盖 28px 的大件装饰值）
    await expect(consoleEl).toHaveCSS("border-radius", "20px");
    // --shadow-lg
    const shadow = await consoleEl.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("24px");
    expect(shadow).toContain("70px");

    await expect(page.locator(".demo .titlebar")).toHaveCSS("padding", "11px 14px");
    await expect(page.locator(".demo .side")).toHaveCSS("width", "150px");
    await expect(page.locator(".demo .stage")).toHaveCSS("min-height", "330px");
    await expect(page.locator(".demo .stage")).toHaveCSS("padding", "14px");
  });

  test("服务状态条（LiveStatus compact）外观锁定", async ({ page }) => {
    await page.goto("/");
    const status = page.locator(".status");
    await expect(status).toBeVisible();

    // 裸条形态：无内边距 / 无边框 / 透明底 / 无毛玻璃
    const live = status.locator(".live");
    await expect(live).toHaveCSS("padding", "0px");
    await expect(live).toHaveCSS("border-top-width", "0px");
    await expect(live).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(live).toHaveCSS("backdrop-filter", "none");

    // 顶部渐变线隐藏
    await expect(status.locator(".live-line").first()).toHaveCSS("display", "none");

    // 横向布局在宽视口左对齐
    await expect(status.locator(".live-row")).toHaveCSS("justify-content", "flex-start");

    // 紧凑尺寸
    await expect(status.locator(".live-ava")).toHaveCSS("width", "28px");
    await expect(status.locator(".live-ava")).toHaveCSS("height", "28px");
    await expect(status.locator(".live-ava")).toHaveCSS("border-radius", "9px");
    await expect(status.locator(".live-label")).toHaveCSS("font-size", "9px");
    await expect(status.locator(".live-state")).toHaveCSS("font-size", "12px");
  });

  test("首页结构未回归", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero .title")).toBeVisible();
    // 四组特性卡 + 安全三宫格为装饰视觉（aria-hidden，不进可访问树）
    await expect(page.locator(".feature-grid .feature-card")).toHaveCount(4);
    const security = page.locator(".security-visual");
    await expect(security).toHaveAttribute("aria-hidden", "true");
    await expect(security.locator(".security-item")).toHaveCount(3);
  });
});
