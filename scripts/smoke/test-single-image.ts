// @ts-nocheck
// V6/V7 acceptance (http): the single-image static carrier.
//   - `/` serves the build-time prerendered home.html (SEO), not the empty shell
//   - unknown app routes (`/dashboard`, ...) fall back to index.html (SPA)
//   - `/api/*` is NOT swallowed by the SPA fallback
//   - `/sw.js` keeps its own content type (excluded from the fallback)
//   - next.config.ts `headers()` still applies to the static pages
//
// Why this script exists: CI's page checks run against vite preview (:4173),
// so the *production* carrier — Next serving public/ in the same image as the
// API (next.config rewrites + headers) — had no automated assertion at all.
//
// Run: npx tsx scripts/smoke/test-single-image.ts
//   expects a built public/ (pnpm build) and a running server at BASE_URL;
//   `pnpm dev` works too, because rewrites/headers apply in dev as well.

import { resolveSmokeBase } from "./lib/base-url";

const BASE = resolveSmokeBase();
const HTML = "text/html";
const MIN_HOME_BYTES = 10_000; // prerendered home.html is ~44KB; the shell is ~1.5KB
const MAX_SHELL_BYTES = 5_000;

const results = [];
let failures = 0;

function check(label, ok, detail = "") {
  results.push(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` | ${detail}` : ""}`);
  if (!ok) failures++;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" }).catch(() => null);
  const body = res ? await res.text().catch(() => "") : "";
  return { status: res?.status ?? 0, headers: res?.headers, body };
}

async function main() {
  console.log(`[single-image] base=${BASE}\n`);

  const shell = await get("/index.html");
  if (shell.status === 404) {
    console.log("SKIP: public/index.html 不存在——先执行 `pnpm build`（single-image 断言需要 Vue 构建产物）");
    return;
  }

  // 1. `/` -> prerendered home.html
  const home = await get("/");
  check("GET / = 200", home.status === 200, String(home.status));
  check("/ 是 HTML", (home.headers?.get("content-type") ?? "").includes(HTML));
  check("/ 返回预渲染首页（体积）", home.body.length > MIN_HOME_BYTES, `${home.body.length} bytes`);
  check("/ 含应用挂载点", home.body.includes('id="app"'));
  check("/ 含预渲染内容（不是空壳）", home.body.includes("<header"), `${home.body.length} vs shell ${shell.body.length}`);
  check("/ 与 SPA 壳不同", home.body !== shell.body);

  // 2. SPA fallback for app routes
  for (const path of ["/dashboard", "/knowledge-base?new=1"]) {
    const page = await get(path);
    check(`GET ${path} = 200`, page.status === 200, String(page.status));
    check(`${path} 是 SPA 壳`, page.body.includes('id="app"') && page.body.length < MAX_SHELL_BYTES, `${page.body.length} bytes`);
  }

  // 3. API must not be swallowed by the fallback
  const health = await get("/api/health");
  check("GET /api/health = 200", health.status === 200, String(health.status));
  check("/api 不被 SPA fallback 吞掉", (health.headers?.get("content-type") ?? "").includes("application/json"));
  let healthJson = null;
  try { healthJson = JSON.parse(health.body); } catch {}
  check("/api/health 返回 JSON", healthJson !== null);

  // 4. PWA files keep their own MIME (fallback exclusion list)
  const sw = await get("/sw.js");
  check("GET /sw.js = 200", sw.status === 200, String(sw.status));
  check("/sw.js 是 JS", (sw.headers?.get("content-type") ?? "").includes("javascript"));

  // 5. Security headers still apply to the static pages
  const h = home.headers ?? new Headers();
  check("X-Frame-Options: DENY", h.get("x-frame-options") === "DENY", h.get("x-frame-options") ?? "missing");
  check("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff", h.get("x-content-type-options") ?? "missing");
  check("Referrer-Policy", (h.get("referrer-policy") ?? "").includes("strict-origin"), h.get("referrer-policy") ?? "missing");
  check("Permissions-Policy 允许相机", (h.get("permissions-policy") ?? "").includes("camera=(self)"), h.get("permissions-policy") ?? "missing");
  check("HSTS", (h.get("strict-transport-security") ?? "").includes("max-age"), h.get("strict-transport-security") ?? "missing");
  check("CSP default-src 'self'", (h.get("content-security-policy") ?? "").includes("default-src 'self'"), h.get("content-security-policy") ?? "missing");

  console.log(`\n${results.join("\n")}`);
  console.log(`\nSingle-image acceptance: ${results.length - failures}/${results.length} passed, ${failures} FAILED`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
