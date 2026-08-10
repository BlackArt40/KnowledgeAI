// @ts-nocheck
// P3-4 acceptance verification: encryption at rest (API keys / model keys /
// password hashing) + security audit trail (sensitive ops, tamper-evident
// hash chain, filterable retrieval, retention policy).
// Run: npx tsx scripts/smoke/test-audit-encrypt.ts   (requires `pnpm dev` on :3000)
//
// Mix of HTTP flows (sensitive operations produce audit entries) and direct
// store-level checks (crypto round-trip, hash-chain tamper detection, trim).

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
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
    const r = await req("POST", "/api/auth/login", { body: { email, password: "password123" } });
    if (!r.data?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  // ── 0. 加密工具（crypto.ts 单测） ─────────────────────────────────────
  console.log("\n── 0. 加密工具（AES-256-GCM） ──");
  const { encrypt, decrypt, encryptToString, decryptFromString, isEncrypted } =
    await import("../../src/lib/security/crypto");
  const pt = "kai_sk_test_secret_123";
  const enc = encrypt(pt);
  check("crypto: encrypt/decrypt round-trip", decrypt(enc) === pt);
  const encStr = encryptToString(pt);
  check("crypto: encryptToString -> isEncrypted", isEncrypted(encStr));
  check("crypto: decryptFromString restores plaintext", decryptFromString(encStr) === pt);
  check("crypto: legacy plaintext passes through", decryptFromString("legacy-plaintext") === "legacy-plaintext");
  let threw = false;
  try {
    // Corrupt the ciphertext while keeping the JSON envelope valid so the
    // GCM auth-tag check fails inside decrypt().
    const parsed = JSON.parse(encStr);
    parsed.data = "AAAA" + parsed.data.slice(4);
    decryptFromString(JSON.stringify(parsed));
  } catch { threw = true; }
  check("crypto: corrupted ciphertext THROWS (no silent fallback)", threw);

  // ── 1. API Key 加密存储（store 层 + HTTP） ────────────────────────────
  console.log("\n── 1. API Key 加密存储 ──");
  const { createKey, validateApiKey, listKeys } = await import("../../src/lib/apikeys/store");
  const created = createKey("p3-4-test", ["kb:read"], "usr_owner");
  const stored = listKeys("usr_owner").find((k) => k.id === created.id);
  check("apikey: in-memory secret is ENCRYPTED at rest", stored ? isEncrypted(stored.secret) : false);
  check("apikey: validateApiKey still works with plaintext secret", !!validateApiKey(created.secret));
  check("apikey: wrong secret rejected", validateApiKey("kai_sk_wrongsecret00000000000000000000") === null);

  const adminToken = await login("admin@knowledgeai.dev");
  const keyRes = await req("POST", "/api/api-keys", { token: adminToken, body: { name: "p3-4-http", scopes: ["kb:read"] } });
  check("apikey: creation returns full secret ONCE (201)", keyRes.status === 201 && keyRes.data?.key?.secret?.startsWith("kai_sk_"), `${keyRes.status}`);
  const keyList = await req("GET", "/api/api-keys", { token: adminToken });
  const listed = keyList.data?.keys?.find((k: any) => k.id === keyRes.data?.key?.id);
  check("apikey: GET list does NOT leak the secret", !!listed && listed.secret === undefined && !JSON.stringify(listed).includes(keyRes.data?.key?.secret ?? "__nope__"), `got secret field: ${JSON.stringify(listed).slice(0, 120)}`);

  // ── 2. 密码哈希（PBKDF2 迁移） ────────────────────────────────────────
  console.log("\n── 2. 密码哈希 PBKDF2 ──");
  const ownerToken = await login("owner@knowledgeai.dev"); // triggers legacy -> PBKDF2 migration
  check("auth: seed login works (legacy hash accepted)", !!ownerToken);
  // Second login goes through the PBKDF2 verify path - success proves the
  // migrated hash is usable (no store peeking across processes).
  const secondLogin = await req("POST", "/api/auth/login", { body: { email: "owner@knowledgeai.dev", password: "password123" } });
  check("auth: login works with migrated PBKDF2 hash", secondLogin.status === 200 && !!secondLogin.data?.token, `${secondLogin.status}`);
  const badLogin = await req("POST", "/api/auth/login", { body: { email: "owner@knowledgeai.dev", password: "wrong-password" } });
  check("auth: wrong password rejected (401)", badLogin.status === 401);

  // ── 3. 敏感操作审计（HTTP 触发） ──────────────────────────────────────
  console.log("\n── 3. 敏感操作审计 ──");
  const audit = await import("../../src/lib/security/audit");
  const { generateTOTP } = await import("../../src/lib/security/totp");

  // 3a. KB 删除
  const kb1 = await req("POST", "/api/knowledge-base", { token: ownerToken, body: { name: "audit-test-kb" } });
  const kbId1 = kb1.data?.kb?.id;
  check("audit-flow: kb created", (kb1.status === 200 || kb1.status === 201) && !!kbId1, `${kb1.status} ${JSON.stringify(kb1.data)}`);
  if (kbId1) {
    const del = await req("DELETE", `/api/knowledge-base/${kbId1}`, { token: ownerToken });
    check("audit-flow: kb deleted", del.status === 200);
  }

  // 3b. 文档删除（匿名 401 修复验证 + owner 删除）。文档来自种子 KB -
  // the store is per-process, so create docs via HTTP listing instead of a
  // direct import (which would live in this script's process, not the server).
  const kbList = await req("GET", "/api/knowledge-base", { token: ownerToken });
  const seedKb = (kbList.data?.kbs ?? []).find((k: any) => k.ownerId === "usr_owner") ?? kbList.data?.kbs?.[0];
  if (seedKb?.id) {
    const kbDetail = await req("GET", `/api/knowledge-base/${seedKb.id}`, { token: ownerToken });
    const doc = kbDetail.data?.docs?.[0];
    if (doc?.id) {
      const anonDel = await req("DELETE", `/api/knowledge-base/${seedKb.id}/documents/${doc.id}`);
      check("doc: anonymous delete rejected (401 - auth hole fixed)", anonDel.status === 401, `got ${anonDel.status}`);
      const del = await req("DELETE", `/api/knowledge-base/${seedKb.id}/documents/${doc.id}`, { token: ownerToken });
      check("audit-flow: doc deleted", del.status === 200, `got ${del.status} ${JSON.stringify(del.data)}`);
    } else {
      check("audit-flow: doc deleted", false, "no docs in seed kb");
    }
  } else {
    check("audit-flow: doc deleted", false, "no kb available");
  }

  // 3c. API Key 删除
  if (keyRes.data?.key?.id) {
    const delKey = await req("DELETE", `/api/api-keys/${keyRes.data.key.id}`, { token: adminToken });
    check("audit-flow: api key deleted", delKey.status === 200);
  }

  // 3d. 用户封禁/解封
  const ban = await req("PATCH", "/api/admin/users/usr_viewer", { token: adminToken, body: { status: "banned" } });
  const unban = await req("PATCH", "/api/admin/users/usr_viewer", { token: adminToken, body: { status: "active" } });
  check("audit-flow: ban/unban ok", ban.status === 200 && unban.status === 200);

  // 3e. KB 共享权限
  const kb3 = await req("POST", "/api/knowledge-base", { token: ownerToken, body: { name: "audit-test-access" } });
  const kbId3 = kb3.data?.kb?.id;
  if (kbId3) {
    const acc = await req("PATCH", "/api/team/kb-access", { token: adminToken, body: { kbId: kbId3, access: "edit" } });
    check("audit-flow: kb access changed", acc.status === 200);
    await req("DELETE", `/api/knowledge-base/${kbId3}`, { token: ownerToken }); // cleanup
  }

  // 3f. 2FA 启用/禁用（真实 TOTP 流程）
  const editorToken = await login("editor@knowledgeai.dev");
  const enroll = await req("POST", "/api/security/2fa", { token: editorToken, body: { action: "enroll" } });
  const totpSecret = enroll.data?.secret;
  if (totpSecret) {
    const code = generateTOTP(totpSecret);
    const verify2fa = await req("POST", "/api/security/2fa", { token: editorToken, body: { action: "verify", code } });
    check("audit-flow: 2fa enabled", verify2fa.status === 200);
    const code2 = generateTOTP(totpSecret);
    const disable2fa = await req("POST", "/api/security/2fa", { token: editorToken, body: { action: "disable", code: code2 } });
    check("audit-flow: 2fa disabled", disable2fa.status === 200);
  } else {
    check("audit-flow: 2fa enabled", false, "enroll failed");
  }

  // 3g. GDPR 数据导出
  const exportRes = await req("GET", "/api/security/export", { token: adminToken });
  check("audit-flow: GDPR export ok", exportRes.status === 200);

  // 3h. 系统配置变更（改回原值）
  const cfg1 = await req("PATCH", "/api/admin/config", { token: adminToken, body: { maxUploadMb: 66 } });
  const cfg2 = await req("PATCH", "/api/admin/config", { token: adminToken, body: { maxUploadMb: 50 } });
  check("audit-flow: config updated", cfg1.status === 200 && cfg2.status === 200);

  // ── 4. 审计检索 + 哈希链（HTTP） ─────────────────────────────────────
  console.log("\n── 4. 审计检索 + 链校验 ──");
  const dash = await req("GET", "/api/admin/audit", { token: adminToken });
  check("audit-api: admin can read", dash.status === 200 && Array.isArray(dash.data?.audit));
  check("audit-api: chain valid", dash.data?.chainValid === true, `chainValid=${dash.data?.chainValid}`);

  const byAction = await req("GET", "/api/admin/audit?action=kb.delete", { token: adminToken });
  check("audit-api: filter by action (kb.delete)", byAction.data?.total >= 3 && byAction.data?.audit?.every((a: any) => a.action === "kb.delete"), `total=${byAction.data?.total}`);

  const byActor = await req("GET", "/api/admin/audit?actor=张明", { token: adminToken });
  check("audit-api: filter by actor", byActor.data?.total >= 1 && byActor.data?.audit?.every((a: any) => a.actor.includes("张明") || (a.actorId ?? "").includes("张明")), `total=${byActor.data?.total}`);

  const from = Date.now() - 120_000;
  const to = Date.now() + 5_000;
  const byTime = await req("GET", `/api/admin/audit?from=${from}&to=${to}`, { token: adminToken });
  check("audit-api: filter by time range", byTime.data?.total >= 10 && byTime.data?.audit?.every((a: any) => a.createdAt >= from && a.createdAt <= to), `total=${byTime.data?.total}`);

  const forbidden = await req("GET", "/api/admin/audit", { token: editorToken });
  check("audit-api: non-admin forbidden (403)", forbidden.status === 403, `got ${forbidden.status}`);

  // All expected sensitive actions present?
  const all = dash.data?.audit ?? [];
  const actions = new Set(all.map((a: any) => a.action));
  for (const act of ["auth.login_success", "auth.login_failed", "kb.delete", "doc.delete", "apikey.delete", "admin.user_ban", "admin.user_unban", "kb.access_change", "security.2fa_enable", "security.2fa_disable", "privacy.export", "admin.config_update"]) {
    check(`audit: ${act} recorded`, actions.has(act), `missing from ${[...actions].join(",")}`);
  }

  // ── 5. 哈希链防篡改（同进程自建链 - server 的链已由 HTTP chainValid 验证） ──
  console.log("\n── 5. 哈希链防篡改 ──");
  audit.recordAudit({ actor: "tester", action: "test.chain_1", detail: "first" });
  audit.recordAudit({ actor: "tester", action: "test.chain_2", detail: "second" });
  check("chain: intact before tampering", audit.verifyAuditChain().valid);
  const g = globalThis as any;
  const trail = g.__KAI_AUDIT_STORE__;
  if (trail && trail.length >= 2) {
    const victim = trail[trail.length - 1]; // oldest entry
    const original = victim.detail;
    victim.detail = "TAMPERED";
    check("chain: tamper detected (invalid)", !audit.verifyAuditChain().valid);
    victim.detail = original;
    check("chain: restore makes it valid again", audit.verifyAuditChain().valid);
  } else {
    check("chain: tamper detected (invalid)", false, "no audit entries in store");
  }

  // ── 6. 保留策略（同进程） ─────────────────────────────────────────────
  console.log("\n── 6. 数据保留策略 ──");
  const trailNow = g.__KAI_AUDIT_STORE__;
  if (trailNow) {
    trailNow.unshift({
      id: "aud_fake_old", actorId: null, actor: "系统", action: "audit.retention_test",
      target: "", detail: "very old entry", ip: null,
      createdAt: Date.now() - 200 * 86_400_000, prevHash: trailNow[1]?.hash ?? "genesis", hash: "fakehash",
    });
    const trimmed = audit.trimAudit();
    const after = g.__KAI_AUDIT_STORE__; // trimAudit replaces the array
    check("retention: old entry trimmed by trimAudit()", trimmed >= 1 && !after.some((e: any) => e.id === "aud_fake_old"), `trimmed=${trimmed}`);
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
