// @ts-nocheck
// P7-1 acceptance verification (HTTP): OpenAPI spec + interactive docs.
//   - GET /api/openapi.json returns a valid OpenAPI 3.0.3 spec covering all
//     /api/v1/* paths with bearer security schemes
//   - /docs renders the Swagger UI shell (bundle + css served from
//     /vendor/swagger-ui/*, copied by scripts/tools/copy-swagger-ui.mjs)
//   - the v1 surface enforces API-key scopes (403 without the right scope)
// Run: npx tsx scripts/smoke/test-openapi.ts   (requires `pnpm dev`)

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
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }

  // ── 1. OpenAPI 规范 ──────────────────────────────────────────────────
  console.log("\n── 1. /api/openapi.json 规范 ──");
  const spec = await req("GET", "/api/openapi.json");
  const s = spec.data;
  check("openapi: 200", spec.status === 200, `status=${spec.status}`);
  check("openapi: 3.0.3", s?.openapi === "3.0.3", String(s?.openapi));
  check("openapi: info.title + version v1", !!s?.info?.title && s.info.version === "v1");
  check("openapi: securitySchemes.bearerAuth", !!s?.components?.securitySchemes?.bearerAuth?.type);
  const paths = Object.keys(s?.paths ?? {});
  const v1 = paths.filter((p) => p.startsWith("/api/v1/"));
  check(`openapi: covers v1 surface (${v1.length} paths)`, v1.length >= 7, v1.join(","));
  const expected = ["/api/v1/me", "/api/v1/knowledge-bases", "/api/v1/chat", "/api/v1/agent/run", "/api/v1/webhooks"];
  for (const p of expected) check(`openapi: path ${p}`, paths.includes(p));

  // ── 2. /docs Swagger UI ──────────────────────────────────────────────
  console.log("\n── 2. /docs 交互式文档 ──");
  const docs = await fetch(`${BASE}/docs`);
  const docsHtml = await docs.text();
  check("docs: 200", docs.status === 200, `status=${docs.status}`);
  check("docs: contains swagger-ui container", docsHtml.includes("kai-swagger-ui"), "missing #kai-swagger-ui");
  const bundle = await fetch(`${BASE}/vendor/swagger-ui/swagger-ui-bundle.js`);
  check("swagger-ui bundle: 200", bundle.status === 200, `status=${bundle.status}`);
  const bundleText = await bundle.text();
  check("swagger-ui bundle: real content", bundleText.length > 100_000, `len=${bundleText.length}`);
  const css = await fetch(`${BASE}/vendor/swagger-ui/swagger-ui.css`);
  check("swagger-ui css: 200", css.status === 200, `status=${css.status}`);
  const preset = await fetch(`${BASE}/vendor/swagger-ui/swagger-ui-standalone-preset.js`);
  check("swagger-ui standalone preset: 200", preset.status === 200, `status=${preset.status}`);

  // ── 3. v1 scope 强制 ─────────────────────────────────────────────────
  console.log("\n── 3. /api/v1 scope 强制 ──");
  const login = (email) =>
    req("POST", "/api/auth/login", { body: { email, password: "password123" } });
  const owner = await login("owner@knowledgeai.dev");
  const token = owner.data?.token;
  check("login: owner token", !!token);

  // API key with kb:read + chat:read only (no agent:run)
  const keyRes = await req("POST", "/api/api-keys", {
    token,
    body: { name: "p7-test", scopes: ["kb:read", "chat:read"] },
  });
  const apiKey = keyRes.data?.key?.secret;
  check("create api key", !!apiKey, JSON.stringify(keyRes.data).slice(0, 120));

  const anon = await req("GET", "/api/v1/knowledge-bases");
  check("v1 kbs 匿名: 401", anon.status === 401, `status=${anon.status}`);
  const me = await req("GET", "/api/v1/me", { apiKey });
  check("v1 me with key: 200 + user", me.status === 200 && !!me.data?.user?.id, `status=${me.status}`);
  const kbs = await req("GET", "/api/v1/knowledge-bases", { apiKey });
  check("v1 kbs with kb:read: 200", kbs.status === 200 && Array.isArray(kbs.data?.kbs), `status=${kbs.status}`);
  const agentDenied = await req("POST", "/api/v1/agent/run", { apiKey, body: { topic: "趋势" } });
  check("v1 agent without agent:run: 403", agentDenied.status === 403, `status=${agentDenied.status}`);
  check("v1 agent 403 carries required scope", agentDenied.headers?.get?.("x-kai-required-scope") === "agent:run", String(agentDenied.headers?.get?.("x-kai-required-scope")));
  const badKey = await req("GET", "/api/v1/me", { apiKey: "kai_sk_invalid" });
  check("v1 me with invalid key: 401", badKey.status === 401, `status=${badKey.status}`);
  const kbCreate = await req("POST", "/api/v1/knowledge-bases", { apiKey, body: { name: "SDK 测试库" } });
  check("v1 kbs without kb:write: 403", kbCreate.status === 403, `status=${kbCreate.status}`);

  // ── 4. 汇总 ──────────────────────────────────────────────────────────
  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅" : "❌"} openapi smoke: ${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
