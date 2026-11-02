// @ts-nocheck
// 共享与分发验收：知识库级公开分享链接。
//   - 库级链接创建/替换/撤销（owner / editor 权限边界）
//   - 公开读取：密码门、过期、次数上限、撤销后的错误码
//   - 文档级 private 覆盖不随库链接暴露
//   - 响应不泄露 passwordHash；创建/撤销入审计链
// Run: npx tsx scripts/smoke/test-kb-share.ts   (requires `pnpm dev` on :3000)

import { resolveSmokeBase } from "./lib/base-url";
import { DEMO_PASSWORD } from "./lib/demo";

const BASE = resolveSmokeBase();

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
  ) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Cookie = `kai-token=${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }

  async function login(email: string): Promise<string> {
    const r = await req("POST", "/api/auth/login", { body: { email, password: DEMO_PASSWORD } });
    if (!r.data?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const owner = await login("owner@knowledgeai.dev");
  const editor = await login("editor@knowledgeai.dev");
  const admin = await login("admin@knowledgeai.dev");

  const kbRes = await req("POST", "/api/knowledge-base", { token: owner, body: { name: "share-kb-test" } });
  const kbId = kbRes.data?.kb?.id;
  check("setup: kb created", (kbRes.status === 200 || kbRes.status === 201) && !!kbId, `${kbRes.status}`);
  if (!kbId) { console.log(results.join("\n")); process.exit(1); }

  async function addDoc(name: string) {
    const r = await req("POST", `/api/knowledge-base/${kbId}/upload`, {
      token: owner,
      body: { url: `${BASE}/`, name },
    });
    return r.data?.docs?.[0];
  }
  const pubDoc = await addDoc("share-public.md");
  const privDoc = await addDoc("share-private.md");
  check("setup: docs added", !!pubDoc?.id && !!privDoc?.id, JSON.stringify({ pubDoc, privDoc }).slice(0, 200));

  const setPrivate = await req("PATCH", `/api/knowledge-base/${kbId}/documents/${privDoc.id}`, {
    token: owner,
    body: { access: "private" },
  });
  check("setup: private doc override set", setPrivate.status === 200, `${setPrivate.status}`);

  // ── 1. 权限边界 ───────────────────────────────────────────────────────
  console.log("\n── 1. 权限边界 ──");
  const editorDenied = await req("POST", `/api/knowledge-base/${kbId}/share`, {
    token: editor, body: {},
  });
  check("acl: non-editor cannot create a link (403)", editorDenied.status === 403, `got ${editorDenied.status}`);

  const initial = await req("GET", `/api/knowledge-base/${kbId}/share`, { token: owner });
  check("share: no active link initially", initial.status === 200 && initial.data?.share === null, `${initial.status}`);

  // ── 2. 创建（密码 + 有效期 + 次数）────────────────────────────────────
  console.log("\n── 2. 创建分享链接 ──");
  const created = await req("POST", `/api/knowledge-base/${kbId}/share`, {
    token: owner,
    body: { password: "kb-secret", maxViews: 5, expiresAt: Date.now() + 3_600_000 },
  });
  const token = created.data?.share?.token;
  check("share: created (201)", created.status === 201 && typeof token === "string" && token.startsWith("ks_"), `${created.status} ${JSON.stringify(created.data).slice(0, 120)}`);
  check("share: response hides passwordHash", !!created.data?.share && !("passwordHash" in created.data.share));
  check("share: views start at 0", created.data?.share?.views === 0);

  const cfg = await req("GET", `/api/knowledge-base/${kbId}/share`, { token: owner });
  check("share: owner can read the active config", cfg.status === 200 && cfg.data?.share?.token === token);

  // ── 3. 公开读取：密码门 ───────────────────────────────────────────────
  console.log("\n── 3. 公开读取（密码门）──");
  const noPwd = await req("GET", `/api/share/kb/${token}`);
  check("public: missing password -> 401 needPassword", noPwd.status === 401 && noPwd.data?.code === "needPassword", `${noPwd.status}`);

  const wrongPwd = await req("GET", `/api/share/kb/${token}`, { headers: { "x-share-password": "nope" } });
  check("public: wrong password -> 401", wrongPwd.status === 401, `${wrongPwd.status}`);

  const okPwd = await req("GET", `/api/share/kb/${token}`, { headers: { "x-share-password": "kb-secret" } });
  const listNames = (okPwd.data?.docs ?? []).map((d: any) => d.name);
  check("public: correct password -> 200", okPwd.status === 200, `${okPwd.status} ${JSON.stringify(okPwd.data).slice(0, 120)}`);
  check("public: kb metadata exposed", okPwd.data?.kb?.name === "share-kb-test", JSON.stringify(okPwd.data?.kb));
  check("public: public doc listed", listNames.includes("share-public.md"), `docs=${listNames.join(",")}`);
  check("public: private doc hidden", !listNames.includes("share-private.md"), `docs=${listNames.join(",")}`);
  check("public: list carries no full content", (okPwd.data?.docs ?? []).every((d: any) => d.content === undefined));
  check("public: view counted once", okPwd.data?.views === 1, `views=${okPwd.data?.views}`);

  // ── 4. 文档预览 ───────────────────────────────────────────────────────
  console.log("\n── 4. 文档预览 ──");
  const preview = await req("GET", `/api/share/kb/${token}?doc=${pubDoc.id}`, {
    headers: { "x-share-password": "kb-secret" },
  });
  check("preview: public doc content returned", preview.status === 200 && typeof preview.data?.doc?.content === "string", `${preview.status}`);
  check("preview: does not consume a view", preview.data?.views === 1, `views=${preview.data?.views}`);

  const privPreview = await req("GET", `/api/share/kb/${token}?doc=${privDoc.id}`, {
    headers: { "x-share-password": "kb-secret" },
  });
  check("preview: private doc -> 404", privPreview.status === 404 && privPreview.data?.code === "notFound", `${privPreview.status}`);

  // ── 5. 替换 / 次数上限 / 过期 / 撤销 ─────────────────────────────────
  console.log("\n── 5. 次数 / 过期 / 撤销 ──");
  const limited = await req("POST", `/api/knowledge-base/${kbId}/share`, {
    token: owner, body: { maxViews: 1 },
  });
  const limitToken = limited.data?.share?.token;
  check("share: replaced with maxViews=1", limited.status === 201 && !!limitToken && limitToken !== token);
  const oldGone = await req("GET", `/api/share/kb/${token}`, { headers: { "x-share-password": "kb-secret" } });
  check("share: previous token invalidated", oldGone.status === 404, `${oldGone.status}`);

  const v1 = await req("GET", `/api/share/kb/${limitToken}`);
  check("limit: first view ok (200)", v1.status === 200, `${v1.status}`);
  const v2 = await req("GET", `/api/share/kb/${limitToken}`);
  check("limit: exhausted -> 403", v2.status === 403 && v2.data?.code === "exhausted", `${v2.status}`);

  const expiring = await req("POST", `/api/knowledge-base/${kbId}/share`, {
    token: owner, body: { expiresAt: Date.now() - 1_000 },
  });
  const expired = await req("GET", `/api/share/kb/${expiring.data?.share?.token}`);
  check("expiry: expired link -> 410", expired.status === 410 && expired.data?.code === "expired", `${expired.status}`);

  const revoke = await req("DELETE", `/api/knowledge-base/${kbId}/share`, { token: owner });
  check("share: revoked", revoke.status === 200 && revoke.data?.ok === true, `${revoke.status}`);
  const gone = await req("GET", `/api/share/kb/${expiring.data?.share?.token}`);
  check("share: revoked link -> 404", gone.status === 404, `${gone.status}`);

  // ── 6. 审计 ───────────────────────────────────────────────────────────
  console.log("\n── 6. 审计 ──");
  const audit = await req("GET", "/api/admin/audit?action=sharelink&limit=50", { token: admin });
  const entries = audit.data?.audit ?? [];
  const hit = entries.filter((e: any) => e.target === "share-kb-test");
  check("audit: create/revoke recorded", audit.status === 200 && hit.length >= 2, `total=${audit.data?.total} hit=${hit.length}`);
  check("audit: chain still valid", audit.data?.chainValid === true, `${audit.data?.chainValid}`);

  // ── 清理 ──────────────────────────────────────────────────────────────
  const cleanup = await req("DELETE", `/api/knowledge-base/${kbId}`, { token: owner });
  check("cleanup: kb deleted", cleanup.status === 200, `${cleanup.status}`);

  console.log("\n" + results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} assertions passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
