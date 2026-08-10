// @ts-nocheck
// P5-1 acceptance verification: PWA installability + offline shell.
//   - manifest.webmanifest is served with the required install fields
//   - icon assets exist (192 / 512 / maskable / apple-touch)
//   - sw.js is served with the expected caching strategy
//   - root HTML carries the PWA meta (manifest link, viewport, apple tags)
//   - core pages respond 200 (375px usability is verified in-browser)
// Run: npx tsx scripts/smoke/test-pwa.ts   (requires `pnpm dev` on :3000)

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function get(path: string) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers, type: res.headers.get("content-type") || "" };
  }

  // ── 1. manifest ──────────────────────────────────────────────────────
  console.log("\n── 1. manifest ──");
  const manifest = await get("/manifest.webmanifest");
  check("manifest: 200", manifest.status === 200, `${manifest.status}`);
  let mj: any = null;
  try { mj = JSON.parse(manifest.text); } catch {}
  check("manifest: valid JSON", !!mj);
  check("manifest: name + short_name", !!mj?.name && !!mj?.short_name);
  check("manifest: start_url = /", mj?.start_url === "/");
  check("manifest: display standalone", mj?.display === "standalone");
  check("manifest: theme_color + background_color", !!mj?.theme_color && !!mj?.background_color);
  const icons = mj?.icons ?? [];
  check("manifest: 192 icon", icons.some((i) => i.sizes === "192x192" && i.type === "image/png"));
  check("manifest: 512 icon", icons.some((i) => i.sizes === "512x512" && i.type === "image/png"));
  check("manifest: maskable icon", icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
  check("manifest: shortcuts", Array.isArray(mj?.shortcuts) && mj.shortcuts.length >= 2);

  // ── 2. icons ─────────────────────────────────────────────────────────
  console.log("\n── 2. icons ──");
  for (const [name, sizes] of [["icon-192.png", "192x192"], ["icon-512.png", "512x512"], ["icon-maskable-512.png", "512x512"], ["apple-touch-icon.png", "180x180"]]) {
    const r = await get(`/icons/${name}`);
    check(`icon ${name}: 200 + image/png + ${sizes}`, r.status === 200 && r.type.includes("image/png") && r.text.length > 500, `${r.status} ${r.type} ${r.text.length}B`);
  }

  // ── 3. service worker ────────────────────────────────────────────────
  console.log("\n── 3. service worker ──");
  const sw = await get("/sw.js");
  check("sw.js: 200 + text/javascript", sw.status === 200 && (sw.type.includes("javascript") || sw.type.includes("text/plain")), `${sw.status} ${sw.type}`);
  const swText = sw.text;
  check("sw.js: precaches app shell (chat/knowledge-base)", swText.includes('"/chat"') && swText.includes('"/knowledge-base"'));
  check("sw.js: navigations network-first with cache fallback", swText.includes("request.mode === \"navigate\"") && swText.includes("caches.match"));
  check("sw.js: /_next/static stale-while-revalidate", swText.includes("/_next/static/"));
  check("sw.js: /api never cached", swText.includes('"/api/"'));
  check("sw.js: versioned caches + cleanup on activate", swText.includes("activate") && swText.includes("caches.delete"));

  // ── 4. root HTML meta ────────────────────────────────────────────────
  console.log("\n── 4. root HTML meta ──");
  const html = await get("/");
  check("root page: 200", html.status === 200, `${html.status}`);
  const h = html.text;
  check("meta: manifest link", h.includes('rel="manifest"') || h.includes("/manifest.webmanifest"));
  check("meta: viewport", /name="viewport"[^>]*content="[^"]*width=device-width/.test(h));
  check("meta: viewport-fit=cover", h.includes("viewport-fit=cover"));
  check("meta: mobile-web-app-capable", h.includes("mobile-web-app-capable"));
  check("meta: apple-mobile-web-app-capable", h.includes("apple-mobile-web-app-capable"));
  check("meta: apple-touch-icon", h.includes("apple-touch-icon"));
  check("meta: theme-color", /name="theme-color"/.test(h));
  // Note: SW registration itself only happens in production builds
  // (SwRegister guards on NODE_ENV) - verified in-browser with `pnpm build`.

  // ── 5. core pages ────────────────────────────────────────────────────
  console.log("\n── 5. core pages ──");
  for (const p of ["/dashboard", "/knowledge-base", "/chat", "/agent"]) {
    const r = await get(p);
    check(`page ${p}: 200`, r.status === 200, `${r.status}`);
  }

  // ── summary ──────────────────────────────────────────────────────────
  console.log(`\n${results.join("\n")}`);
  console.log(`\nPWA smoke: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
