// 批 4：PWA 离线（第 13 类测试手段）。
//
// 契约来自 public/sw.js：
//   * 只预缓存「未认证壳」("/", "/login") + 图标/manifest；
//   * 导航走 network-first，离线时只有 APP_SHELL 里的路径回缓存，其它一律
//     返回显式的 503 离线页（不拿缓存冒充服务器还活着）；
//   * /api/** 完全不拦截 —— 绝不缓存租户数据。
//
// 只在 chromium 跑：SW/离线语义各引擎差异大，纳入跨浏览器矩阵会变成
// 「测浏览器实现」而不是「测我们的契约」。
import { expect, test } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "PWA 离线契约先锁 chromium");

/** SW 接管 + 预缓存写完后，离线断言才有意义。 */
async function waitForShellCache(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg?.active) return false;
      const keys = await caches.keys();
      if (!keys.some((k) => k.endsWith("-shell"))) return false;
      return !!(await caches.match("/"));
    },
    undefined,
    { timeout: 30_000 }
  );
}

test.describe("PWA 离线", () => {
  test("未认证壳离线可打开，鉴权页回落到离线提示页", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator(".hero .title")).toBeVisible();
    await waitForShellCache(page);

    await context.setOffline(true);
    await page.reload();

    // 预缓存过的 "/" 直接来自缓存，仍然是官网而不是错误页。
    await expect(page.locator(".hero .title")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("服务暂时不可用")).toHaveCount(0);

    // 工作台不在 APP_SHELL 里：离线必须显式失败，而不是假装有内容。
    await page.goto("/dashboard");
    await expect(page.getByText("服务暂时不可用")).toBeVisible({ timeout: 20_000 });

    await context.setOffline(false);
  });

  test("API 响应永不进缓存", async ({ page, context }) => {
    await page.goto("/");
    await waitForShellCache(page);

    await context.setOffline(true);

    const cachedApi = await page.evaluate(async () => !!(await caches.match("/api/health")));
    expect(cachedApi).toBe(false);

    const result = await page.evaluate(async () =>
      fetch("/api/health")
        .then((r) => `status:${r.status}`)
        .catch(() => "network-error")
    );
    // 离线时请求直接失败（浏览器网络错误），说明没有 Service Worker 兜底。
    expect(result).toBe("network-error");

    await context.setOffline(false);
  });
});
