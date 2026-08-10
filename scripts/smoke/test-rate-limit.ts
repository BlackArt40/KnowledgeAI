// @ts-nocheck
// P3-3 acceptance verification: tiered rate limiting (anonymous / user /
// API key / KB), accurate Retry-After, and the admin rate-limit dashboard.
// Run: npx tsx scripts/smoke/test-rate-limit.ts   (requires `pnpm dev` on :3000)
//
// Each tier uses its own independent key (ip:<ip> / user:<id> / apikey:<id> /
// kb:<id>), so no window reset waits are needed between tiers.
// Expected env (see .env.example): anon < user and kb < user limits.

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method: string, path: string, opts: { token?: string; apiKey?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Cookie = `kai-token=${opts.token}`;
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }

  // Hit an endpoint repeatedly until a 429 appears (or the cap is reached).
  // Dev-mode requests take ~200ms each, so sends run CONCURRENTLY - otherwise
  // high quotas (API key tier) would exceed the 60s window before triggering.
  // Returns { first429 (approx 1-based index or 0), response }.
  async function pokeUntil429(makeReq: () => Promise<{ status: number; data: any; headers: Headers }>, cap: number, concurrency = 10) {
    let first429 = 0;
    let sent = 0;
    let last: any = null;
    while (sent < cap) {
      const batch = Math.min(concurrency, cap - sent);
      const rs = await Promise.all(Array.from({ length: batch }, () => makeReq()));
      sent += batch;
      for (const r of rs) {
        if (r.status === 429 && !first429) {
          first429 = sent; // approximate index within the batch
          last = r;
          break;
        }
      }
      if (first429) break;
    }
    return { first429, last };
  }

  // Validate a 429 response shape: dimension, Retry-After, X-RateLimit-*.
  function assert429(res: any, expectedDimension: string, label: string) {
    const retryAfter = res.data?.retryAfter;
    const limitH = res.headers.get("X-RateLimit-Limit");
    const remainH = res.headers.get("X-RateLimit-Remaining");
    const resetH = res.headers.get("X-RateLimit-Reset");
    const now = Date.now();
    check(`${label}: status 429`, res.status === 429, `got ${res.status}`);
    check(`${label}: dimension=${expectedDimension}`, res.data?.dimension === expectedDimension, `got ${res.data?.dimension}`);
    check(`${label}: retryAfter is integer in [1,60]`, Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `got ${retryAfter}`);
    check(`${label}: X-RateLimit-Limit header`, /^\d+$/.test(limitH ?? ""), `got ${limitH}`);
    check(`${label}: X-RateLimit-Remaining=0`, remainH === "0", `got ${remainH}`);
    check(`${label}: X-RateLimit-Reset header`, /^\d+$/.test(resetH ?? ""), `got ${resetH}`);
    // Accuracy: Reset must match Retry-After (both derived from the same resetAt).
    check(`${label}: X-RateLimit-Reset ≈ now + Retry-After`, Math.abs(parseInt(resetH, 10) - (now + retryAfter * 1000)) <= 2000, `reset=${resetH} retryAfter=${retryAfter}`);
  }

  // ── 0. Login helpers ──────────────────────────────────────────────────
  async function login(email: string): Promise<string> {
    const r = await req("POST", "/api/auth/login", { body: { email, password: "password123" } });
    if (!r.data?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  // Logins are anonymous requests, so do them FIRST - the anonymous tier test
  // at the end exhausts the shared ip:<ip> window (nothing anonymous follows it).
  // The API key is also created before the user-tier test exhausts owner's window.
  console.log("── 0. 登录（匿名请求，先行）+ 创建 API Key ──");
  const ownerToken = await login("owner@knowledgeai.dev");
  const adminToken = await login("admin@knowledgeai.dev");
  const editorToken = await login("editor@knowledgeai.dev");
  const keyRes = await req("POST", "/api/api-keys", { token: ownerToken, body: { name: "p3-3-smoke", scopes: ["kb:read"] } });
  check("api key: created", (keyRes.status === 200 || keyRes.status === 201) && !!keyRes.data?.key?.secret, `${keyRes.status} ${JSON.stringify(keyRes.data)}`);
  const secret = keyRes.data?.key?.secret;

  // ── 1. Authenticated user tier (user:<id>, RATE_LIMIT_PER_MIN) ───────
  console.log("\n── 1. 已认证用户分级（用户维度） ──");
  const user = await pokeUntil429(() => req("GET", "/api/knowledge-base", { token: ownerToken }), 250);
  check("user: triggers 429 within cap", user.first429 > 0, `no 429 in 250 tries`);
  if (user.first429 > 0) assert429(user.last, "user", "user");

  // ── 2. API key tier (apikey:<id>, RATE_LIMIT_KEY_PER_MIN) ────────────
  console.log("\n── 2. API Key 分级（apikey 维度） ──");
  let keyTest: any = {};
  if (secret) {
    keyTest = await pokeUntil429(() => req("GET", "/api/knowledge-base", { apiKey: secret }), 160);
    check("apikey: triggers 429 within cap", keyTest.first429 > 0, `no 429 in 160 tries`);
    if (keyTest.first429 > 0) assert429(keyTest.last, "apikey", "apikey");
  }

  // ── 3. Per-KB tier (kb:<id>, RATE_LIMIT_KB_PER_MIN) ──────────────────
  console.log("\n── 3. 按 KB 维度限流 ──");
  const kbsRes = await req("GET", "/api/knowledge-base", { token: editorToken });
  const kbId = kbsRes.data?.kbs?.[0]?.id;
  check("kb: editor can list KBs", kbsRes.status === 200 && !!kbId, `${kbsRes.status} ${JSON.stringify(kbsRes.data)}`);
  if (kbId) {
    const kb = await pokeUntil429(() => req("GET", `/api/knowledge-base/${kbId}`, { token: editorToken }), 90);
    check("kb: triggers 429 within cap (kb limit < user limit)", kb.first429 > 0 && kb.first429 <= 70, `no 429 / at #${kb.first429}`);
    if (kb.first429 > 0) assert429(kb.last, "kb", "kb");
  }

  // ── 4. Anonymous tier (ip:<ip>, RATE_LIMIT_ANON_PER_MIN) - LAST ──────
  console.log("\n── 4. 匿名分级（IP 维度，最后执行） ──");
  const anon = await pokeUntil429(() => req("GET", "/api/billing"), 40);
  check("anon: triggers 429 within cap", anon.first429 > 0, `no 429 in 40 tries`);
  check("anon: low tier (≤ 30, not the user limit)", anon.first429 <= 30 && anon.first429 >= 2, `first 429 at #${anon.first429}`);
  if (anon.first429 > 0) assert429(anon.last, "ip", "anon");

  // Tier ordering: user > anon, apikey > user (independent keys, so the
  // triggers themselves are what prove the tiering).
  check("tiering: user quota > anonymous quota", user.first429 > anon.first429, `anon #${anon.first429} vs user #${user.first429}`);
  if (keyTest.first429 > 0) {
    check("tiering: API key quota > user quota", keyTest.first429 > user.first429, `user #${user.first429} vs apikey #${keyTest.first429}`);
  }

  // ── 5. Admin rate-limit dashboard API ────────────────────────────────
  console.log("\n── 5. 限流仪表盘 API ──");
  // Owner's user window is exhausted by test 1 - use admin (independent window).
  const dash = await req("GET", "/api/admin/ratelimit", { token: adminToken });
  check("dashboard: admin/owner can read (200)", dash.status === 200, `got ${dash.status}`);
  check("dashboard: mode is memory or redis", dash.data?.mode === "memory" || dash.data?.mode === "redis", `got ${dash.data?.mode}`);
  const L = dash.data?.limits;
  check("dashboard: limits expose all 4 tiers", !!L && typeof L.base === "number" && typeof L.anon === "number" && typeof L.key === "number" && typeof L.kb === "number", JSON.stringify(L));
  check("dashboard: kb limit below user limit (tier ordering)", !!L && L.kb < L.base, `kb=${L?.kb} base=${L?.base}`);
  const live = dash.data?.live ?? [];
  const kinds = new Set(live.map((s: any) => s.kind));
  check("dashboard: live stats include ip tier", kinds.has("ip"));
  check("dashboard: live stats include user tier", kinds.has("user"));
  check("dashboard: live stats include apikey tier", kinds.has("apikey"));
  check("dashboard: live stats include kb tier", kinds.has("kb"));
  const dash403 = await req("GET", "/api/admin/ratelimit", { token: editorToken });
  check("dashboard: non-admin forbidden (403)", dash403.status === 403, `got ${dash403.status}`);

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
