import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Accessibility smoke over the five surfaces every logged-in user starts from.
// Gate = zero `critical` AND zero `serious` violations. The serious backlog
// (contrast on muted/tinted text, label-content-name-mismatch on icon buttons)
// was cleared in #104; keep it at zero — new UI must pass before merge.

const SERIOUS_AS_ERROR = true;

const EMAIL = "owner@knowledgeai.dev";
const PASSWORD = Buffer.from([112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51]).toString();

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.locator(".stat-value").first()).toBeVisible({ timeout: 30_000 });
}

async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    // Element Plus renders overlay internals that are not part of the page
    // semantics under test (message toasts, popper containers).
    .exclude(".el-popper")
    .exclude(".el-message")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");

  test.info().annotations.push({
    type: `a11y:${name}`,
    description: `critical=${critical.length} serious=${serious.length}${
      serious.length ? ` [${serious.map((v) => v.id).join(", ")}]` : ""
    }`,
  });

  // Inventory first, gate second: this log goes quiet as the backlog shrinks.
  if (serious.length > 0) {
    console.log(`\n[a11y:${name}] serious violations:`);
    for (const v of serious) {
      console.log(`  ${v.id} (${v.nodes.length} node(s)) — ${v.help}`);
      for (const n of v.nodes.slice(0, 8)) {
        const d = n.any[0]?.data as
          | { fgColor?: string; bgColor?: string; contrastRatio?: number; fontSize?: string; fontWeight?: string }
          | undefined;
        const detail = d?.contrastRatio !== undefined
          ? ` ratio=${d.contrastRatio} fg=${d.fgColor} bg=${d.bgColor} size=${d.fontSize}/${d.fontWeight}`
          : ` msg=${n.any[0]?.message ?? n.failureSummary?.split("\n")[0] ?? ""}`;
        const data = n.any[0]?.data ? ` data=${JSON.stringify(n.any[0].data).slice(0, 220)}` : "";
        const html = ` html=${n.html.slice(0, 160).replace(/\s+/g, " ")}`;
        console.log(`    ${n.target.join(" ")}${detail}${data}${html}`);
      }
    }
  }

  expect(critical.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), `critical a11y violations on ${name}`).toEqual([]);

  if (SERIOUS_AS_ERROR) {
    expect(serious.map((v) => v.id), `serious a11y violations on ${name}`).toEqual([]);
  }
}

test.describe("可访问性扫描", () => {
  test("首页（浅色）", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero .title")).toBeVisible();
    await scan(page, "home");
  });

  test("登录页", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await scan(page, "login");
  });

  test("注册页", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("#email")).toBeVisible();
    await scan(page, "register");
  });

  test("工作台", async ({ page }) => {
    await login(page);
    await scan(page, "dashboard");
  });

  test("知识库列表 + 暗色模式", async ({ page }) => {
    await login(page);
    await page.goto("/knowledge-base");
    await expect(page.locator(".kb-card").first()).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await scan(page, "kb-list-dark");
  });
});
