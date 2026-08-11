// @ts-nocheck
// P5-5 acceptance verification (HTTP): workspace brand color + theme API.
//   - GET /api/workspaces exposes brandColor (workspace-level theme)
//   - PATCH /api/workspaces { brandColor } - owner-only, palette-validated,
//     audited as `workspace.update`
//   - the value survives a GET round-trip (memory path; DB persistence is
//     covered by the persist/hydrate write-through in DB mode)
// Run: npx tsx scripts/smoke/test-theme.ts   (requires `pnpm dev`)

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method, path, opts = {}) {
    const headers = {};
    const cookies = [];
    if (opts.token) cookies.push(`kai-token=${opts.token}`);
    if (cookies.length) headers.Cookie = cookies.join("; ");
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }

  const login = (email) =>
    req("POST", "/api/auth/login", { body: { email, password: "password123" } });

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const ownerLogin = await login("owner@knowledgeai.dev");
  const ownerToken = ownerLogin.data?.token;
  check("login: owner token", !!ownerToken);
  const viewerLogin = await login("viewer@knowledgeai.dev");
  const viewerToken = viewerLogin.data?.token;
  check("login: viewer token", !!viewerToken);

  // ── 1. GET 暴露品牌色 ─────────────────────────────────────────────────
  console.log("\n── 1. GET /api/workspaces 品牌色字段 ──");
  const list = await req("GET", "/api/workspaces", { token: ownerToken });
  check("GET: 200", list.status === 200, `status=${list.status}`);
  check("GET: 每个 workspace 带 brandColor", (list.data?.workspaces ?? []).every((w) => typeof w.brandColor === "string"), JSON.stringify(list.data?.workspaces?.[0]));
  check("GET: currentBrandColor 存在", typeof list.data?.currentBrandColor === "string", String(list.data?.currentBrandColor));
  const before = list.data?.currentBrandColor;
  check("GET: 默认品牌色为 indigo", before === "indigo", String(before));

  // ── 2. 校验与权限 ─────────────────────────────────────────────────────
  console.log("\n── 2. PATCH 校验与权限 ──");
  const invalid = await req("PATCH", "/api/workspaces", { token: ownerToken, body: { brandColor: "hotpink" } });
  check("PATCH 非法色: 400", invalid.status === 400, `status=${invalid.status}`);

  const anon = await req("PATCH", "/api/workspaces", { body: { brandColor: "emerald" } });
  check("PATCH 匿名: 401", anon.status === 401, `status=${anon.status}`);

  const viewerPatch = await req("PATCH", "/api/workspaces", { token: viewerToken, body: { brandColor: "emerald" } });
  check("PATCH 非 owner(viewer): 403", viewerPatch.status === 403, `status=${viewerPatch.status}`);

  // ── 3. owner 修改品牌色 → 回读 + 审计 ────────────────────────────────
  console.log("\n── 3. owner 修改品牌色 ──");
  const patch = await req("PATCH", "/api/workspaces", { token: ownerToken, body: { brandColor: "emerald" } });
  check("PATCH owner emerald: 200", patch.status === 200, `status=${patch.status}`);
  check("PATCH 返回 workspace.brandColor=emerald", patch.data?.workspace?.brandColor === "emerald", JSON.stringify(patch.data?.workspace));

  const after = await req("GET", "/api/workspaces", { token: ownerToken });
  const afterColor = after.data?.workspaces?.find((w) => w.id === after.data?.currentWorkspace)?.brandColor;
  check("GET 回读: brandColor=emerald", afterColor === "emerald", String(afterColor));
  check("GET currentBrandColor=emerald", after.data?.currentBrandColor === "emerald", String(after.data?.currentBrandColor));

  // viewer 视角的 GET 也应看到同一 workspace 的品牌色(只读)
  const viewerList = await req("GET", "/api/workspaces", { token: viewerToken });
  const viewerColor = viewerList.data?.workspaces?.find((w) => w.id === viewerList.data?.currentWorkspace)?.brandColor;
  check("viewer GET: 可见品牌色(只读)", viewerColor === "emerald", String(viewerColor));

  // 审计: workspace.update 已记录(owner 可查 /api/admin/audit)
  const audit = await req("GET", "/api/admin/audit?action=workspace.update&limit=20", { token: ownerToken });
  const found = (audit.data?.audit ?? []).some((e) => e.action === "workspace.update" && /emerald/.test(e.detail ?? ""));
  check("审计: workspace.update 记录存在", audit.status === 200 && found, `total=${audit.data?.total}`);
  check("审计链完整", audit.data?.chainValid === true, String(audit.data?.chainValid));

  // ── 4. 清理: 改回 indigo ──────────────────────────────────────────────
  console.log("\n── 4. 清理 ──");
  const reset = await req("PATCH", "/api/workspaces", { token: ownerToken, body: { brandColor: "indigo" } });
  check("清理: 恢复 indigo", reset.status === 200 && reset.data?.workspace?.brandColor === "indigo", `status=${reset.status}`);

  console.log(`\n${results.join("\n")}`);
  console.log(`\nTheme HTTP acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
