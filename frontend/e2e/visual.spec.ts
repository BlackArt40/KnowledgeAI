import { expect, test, type Page } from "@playwright/test";

// Batch 2: pixel regression for the surfaces that CSS refactors keep touching
// (design tokens, dark mode, Element Plus variable mapping). Today the repo has
// no visual gate at all — `home.spec.ts` locks computed values by hand.
//
// Opt-in on purpose: baselines are platform-dependent (font rendering differs
// between macOS and the Linux runner), so they must be generated ON the runner
// that will compare them:
//
//   VISUAL_REGRESSION=1 pnpm -C frontend exec playwright test e2e/visual.spec.ts --update-snapshots
//
// Commit the resulting files, then add VISUAL_REGRESSION=1 to the e2e job to
// turn the comparison on. Until then this spec is skipped, not silently green.

const ENABLED = !!process.env.VISUAL_REGRESSION;

test.skip(!ENABLED, "set VISUAL_REGRESSION=1 (baselines are platform-specific)");

test.use({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});

const EMAIL = "owner@knowledgeai.dev";
const PASSWORD = Buffer.from([112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51]).toString();

const SHOT = {
  // Animations/transitions must be frozen or every run differs.
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
  scale: "css" as const,
};

/** Dynamic regions (counters, clocks, avatars, live status) are masked out. */
async function stabilize(page: Page): Promise<void> {
  await page.addStyleTag({
    content: ".live, .status, .stat-value, .timestamp { visibility: hidden !important; }",
  });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 30_000 });
  await stabilize(page);
}

test.describe("视觉基线", () => {
  test("首页 hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero .title")).toBeVisible();
    await stabilize(page);
    await expect(page.locator(".hero")).toHaveScreenshot("home-hero.png", SHOT);
  });

  test("工作台统计卡", async ({ page }) => {
    await login(page);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".stats")).toHaveScreenshot("dashboard-stats.png", SHOT);
  });

  test("知识库卡片网格", async ({ page }) => {
    await login(page);
    await page.goto("/knowledge-base");
    await expect(page.locator(".kb-card").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".kb-card").first()).toHaveScreenshot("kb-card.png", SHOT);
  });

  test("暗色主题下的工作台", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator(".sidebar")).toHaveScreenshot("dashboard-sidebar-dark.png", SHOT);
  });

  test("登录页表单", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("form").first()).toHaveScreenshot("login-form.png", SHOT);
  });
});
