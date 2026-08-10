// @ts-nocheck
// P4-2 acceptance verification: fine-grained KB permissions.
//   - document-level access (private/view/edit) with inheritance
//   - per-KB member role overrides (owner-granted editor/viewer)
//   - permission-change audit trail
//   - time-limited document share links (expiry / password / view limit / revoke)
// Run: npx tsx scripts/smoke/test-kb-permissions.ts   (requires `pnpm dev` on :3000)

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

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const owner = await login("owner@knowledgeai.dev");
  const admin = await login("admin@knowledgeai.dev");
  const editor = await login("editor@knowledgeai.dev");
  const viewer = await login("viewer@knowledgeai.dev");

  const kbRes = await req("POST", "/api/knowledge-base", { token: owner, body: { name: "permissions-test" } });
  const kbId = kbRes.data?.kb?.id;
  check("setup: kb created", (kbRes.status === 200 || kbRes.status === 201) && !!kbId, `${kbRes.status}`);
  if (!kbId) { console.log(results.join("\n")); process.exit(1); }

  async function addDoc(name: string) {
    const r = await req("POST", `/api/knowledge-base/${kbId}/upload`, {
      token: owner,
      body: { url: "http://localhost:3000/", name },
    });
    return r.data?.docs?.[0];
  }
  const doc1 = await addDoc("perm-doc-1");
  const doc2 = await addDoc("perm-doc-2");
  check("setup: docs added", !!doc1?.id && !!doc2?.id, JSON.stringify({ doc1, doc2 }).slice(0, 200));

  // ── 1. 文档级权限 ─────────────────────────────────────────────────────
  console.log("\n── 1. 文档级权限（继承 / private / edit） ──");
  const inheritGet = await req("GET", `/api/knowledge-base/${kbId}/documents/${doc1.id}`, { token: editor });
  check("doc: editor can read inherited doc (200)", inheritGet.status === 200, `${inheritGet.status}`);

  const setPriv = await req("PATCH", `/api/knowledge-base/${kbId}/documents/${doc1.id}`, { token: owner, body: { access: "private" } });
  check("doc: owner sets private", setPriv.status === 200 && setPriv.data?.doc?.access === "private", `${setPriv.status}`);
  const privGet = await req("GET", `/api/knowledge-base/${kbId}/documents/${doc1.id}`, { token: editor });
  check("doc: private doc hidden from member (403)", privGet.status === 403, `got ${privGet.status}`);
  const kbDetail = await req("GET", `/api/knowledge-base/${kbId}`, { token: editor });
  const visibleNames = (kbDetail.data?.docs ?? []).map((d: any) => d.name);
  check("doc: private doc excluded from KB list", !visibleNames.includes("perm-doc-1"), `docs=${visibleNames.join(",")}`);

  const setEdit = await req("PATCH", `/api/knowledge-base/${kbId}/documents/${doc1.id}`, { token: owner, body: { access: "edit" } });
  check("doc: owner sets edit", setEdit.status === 200);
  const delByEditor = await req("DELETE", `/api/knowledge-base/${kbId}/documents/${doc1.id}`, { token: editor });
  check("doc: edit access grants member delete (200)", delByEditor.status === 200, `${delByEditor.status}`);

  const denyAccess = await req("PATCH", `/api/knowledge-base/${kbId}/documents/${doc2.id}`, { token: editor, body: { access: "private" } });
  check("doc: non-owner cannot set access (403)", denyAccess.status === 403, `got ${denyAccess.status}`);

  // ── 2. per-KB 成员角色 ────────────────────────────────────────────────
  console.log("\n── 2. per-KB 成员角色 ──");
  const makePrivate = await req("PATCH", "/api/team/kb-access", { token: owner, body: { kbId, access: "private" } });
  check("role: kb set private", makePrivate.status === 200);
  const viewerDenied = await req("GET", `/api/knowledge-base/${kbId}`, { token: viewer });
  check("role: viewer denied on private kb (403)", viewerDenied.status === 403, `got ${viewerDenied.status}`);

  const grantEditor = await req("PATCH", "/api/team/kb-access", { token: owner, body: { kbId, email: "viewer@knowledgeai.dev", role: "editor" } });
  check("role: owner grants viewer an editor role", grantEditor.status === 200);
  const viewerAllowed = await req("GET", `/api/knowledge-base/${kbId}`, { token: viewer });
  check("role: viewer override grants access (200)", viewerAllowed.status === 200, `got ${viewerAllowed.status}`);
  const viewerEdits = await req("PATCH", `/api/knowledge-base/${kbId}/documents/${doc2.id}`, { token: viewer, body: { access: "view" } });
  check("role: viewer(editor override) can edit doc access (200)", viewerEdits.status === 200, `got ${viewerEdits.status}`);
  const viewerNotOwner = await req("PATCH", "/api/team/kb-access", { token: editor, body: { kbId, email: "viewer@knowledgeai.dev", role: "editor" } });
  check("role: non-owner cannot grant member roles (403)", viewerNotOwner.status === 403, `got ${viewerNotOwner.status}`);

  const clearRole = await req("PATCH", "/api/team/kb-access", { token: owner, body: { kbId, email: "viewer@knowledgeai.dev", role: null } });
  check("role: owner clears member role", clearRole.status === 200);
  const viewerDeniedAgain = await req("GET", `/api/knowledge-base/${kbId}`, { token: viewer });
  check("role: cleared role revokes access (403)", viewerDeniedAgain.status === 403, `got ${viewerDeniedAgain.status}`);
  const restoreView = await req("PATCH", "/api/team/kb-access", { token: owner, body: { kbId, access: "view" } });
  check("role: kb restored to shared view", restoreView.status === 200);

  // ── 3. 权限审计 ───────────────────────────────────────────────────────
  console.log("\n── 3. 权限审计 ──");
  const auditRes = await req("GET", "/api/admin/audit?action=doc.access_change", { token: admin });
  check("audit: doc.access_change recorded", auditRes.status === 200 && auditRes.data?.total >= 3, `total=${auditRes.data?.total}`);
  const auditRole = await req("GET", "/api/admin/audit?action=kb.access_change&actor=张明", { token: admin });
  check("audit: member-role grant audited as kb.access_change", auditRole.data?.total >= 1, `total=${auditRole.data?.total}`);

  // ── 4. 临时分享链接 ───────────────────────────────────────────────────
  console.log("\n── 4. 临时访问链接 ──");
  // 4a. time-limited link
  const share1 = await req("POST", `/api/knowledge-base/${kbId}/documents/${doc2.id}/share`, {
    token: owner,
    body: { expiresAt: Date.now() + 10_000 },
  });
  const token1 = share1.data?.share?.token;
  check("share: created with expiry", share1.status === 201 && !!token1, `${share1.status}`);
  if (token1) {
    const pub1 = await req("GET", `/api/share/doc/${token1}`);
    check("share: anonymous access works (200)", pub1.status === 200 && pub1.data?.name === "perm-doc-2", `${pub1.status} ${JSON.stringify(pub1.data).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 11_000));
    const expired = await req("GET", `/api/share/doc/${token1}`);
    check("share: expired link returns 410", expired.status === 410 && expired.data?.code === "expired", `${expired.status} ${JSON.stringify(expired.data)}`);
  }

  // 4b. password-protected link
  const share2 = await req("POST", `/api/knowledge-base/${kbId}/documents/${doc2.id}/share`, {
    token: owner,
    body: { password: "secret123" },
  });
  const token2 = share2.data?.share?.token;
  check("share: created with password", share2.status === 201 && !!token2);
  if (token2) {
    const noPwd = await req("GET", `/api/share/doc/${token2}`);
    check("share: missing password -> 401", noPwd.status === 401 && noPwd.data?.code === "needPassword", `${noPwd.status}`);
    const wrongPwd = await req("GET", `/api/share/doc/${token2}?password=wrong`);
    check("share: wrong password -> 401", wrongPwd.status === 401, `${wrongPwd.status}`);
    const rightPwd = await req("GET", `/api/share/doc/${token2}?password=secret123`);
    check("share: correct password -> 200", rightPwd.status === 200, `${rightPwd.status}`);
  }

  // 4c. view-limited link
  const share3 = await req("POST", `/api/knowledge-base/${kbId}/documents/${doc2.id}/share`, {
    token: owner,
    body: { maxViews: 1 },
  });
  const token3 = share3.data?.share?.token;
  check("share: created with maxViews=1", share3.status === 201 && !!token3);
  if (token3) {
    const v1 = await req("GET", `/api/share/doc/${token3}`);
    check("share: first view ok (200)", v1.status === 200, `${v1.status}`);
    const v2 = await req("GET", `/api/share/doc/${token3}`);
    check("share: view limit exhausted -> 403", v2.status === 403 && v2.data?.code === "exhausted", `${v2.status} ${JSON.stringify(v2.data)}`);
  }

  // 4d. revoke
  const share4 = await req("POST", `/api/knowledge-base/${kbId}/documents/${doc2.id}/share`, { token: owner, body: {} });
  const token4 = share4.data?.share?.token;
  check("share: created for revoke test", share4.status === 201 && !!token4);
  if (token4) {
    const revoke = await req("DELETE", `/api/knowledge-base/${kbId}/documents/${doc2.id}/share`, { token: owner });
    check("share: revoked", revoke.status === 200);
    const gone = await req("GET", `/api/share/doc/${token4}`);
    check("share: revoked link returns 404", gone.status === 404, `${gone.status}`);
  }

  // 4e. share audit
  const shareAudit = await req("GET", "/api/admin/audit?action=sharelink", { token: admin });
  check("audit: sharelink.create/revoke recorded", shareAudit.data?.total >= 4, `total=${shareAudit.data?.total}`);

  // 4f. non-owner cannot share
  const denyShare = await req("POST", `/api/knowledge-base/${kbId}/documents/${doc2.id}/share`, { token: editor, body: {} });
  check("share: non-owner cannot create (403)", denyShare.status === 403, `got ${denyShare.status}`);

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
