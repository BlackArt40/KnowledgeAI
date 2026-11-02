// @ts-nocheck
// 权限与管理（谁能动谁）验收：团队角色层级、角色同步、KB 共享权限、
// 成员级授权可见性、封禁即时生效。
// Run: npx tsx scripts/smoke/test-team-admin.ts   (requires `pnpm dev` on :3000)
//
// 脚本会修改种子成员的角色/状态，但每一项都在断言后恢复；仍建议在干净的
// dev 进程上运行（与 test-2fa-http 同理，状态留在内存里）。

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
    return { status: res.status, data };
  }

  async function login(email: string): Promise<{ token?: string; status: number; data: any }> {
    const r = await req("POST", "/api/auth/login", { body: { email, password: DEMO_PASSWORD } });
    return { token: r.data?.token, status: r.status, data: r.data };
  }

  const ownerLogin = await login("owner@knowledgeai.dev");
  const adminLogin = await login("admin@knowledgeai.dev");
  const editorLogin = await login("editor@knowledgeai.dev");
  const viewerLogin = await login("viewer@knowledgeai.dev");
  const owner = ownerLogin.token;
  const admin = adminLogin.token;
  const editor = editorLogin.token;
  const viewer = viewerLogin.token;
  check("setup: four demo roles logged in", !!owner && !!admin && !!editor && !!viewer);

  // ── 0. 角色层级：同级/上级不可管理 ────────────────────────────────────
  console.log("\n── 0. 相对权限（同级/上级不可管理） ──");
  const team = await req("GET", "/api/team", { token: owner });
  const members = team.data?.members ?? [];
  const adminMember = members.find((m: any) => m.email === "admin@knowledgeai.dev");
  const editorMember = members.find((m: any) => m.email === "editor@knowledgeai.dev");
  check("setup: member ids resolved", !!adminMember?.id && !!editorMember?.id);

  const adminDemotePeer = await req("PATCH", `/api/team/members/${adminMember.id}`, {
    token: admin, body: { role: "viewer" },
  });
  check("admin cannot demote another admin (403)", adminDemotePeer.status === 403, `got ${adminDemotePeer.status}`);

  const adminRemovePeer = await req("DELETE", `/api/team/members/${adminMember.id}`, { token: admin });
  check("admin cannot remove another admin (403)", adminRemovePeer.status === 403, `got ${adminRemovePeer.status}`);

  const adminMintPeer = await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: admin, body: { role: "admin" },
  });
  check("admin cannot promote an editor to admin (403)", adminMintPeer.status === 403, `got ${adminMintPeer.status}`);

  const adminInvitePeer = await req("POST", "/api/team/invite", {
    token: admin, body: { email: `peer-${Date.now()}@knowledgeai.dev`, role: "admin" },
  });
  check("admin cannot invite another admin (403)", adminInvitePeer.status === 403, `got ${adminInvitePeer.status}`);

  const adminDemoteEditor = await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: admin, body: { role: "viewer" },
  });
  check("admin can demote an editor (200)", adminDemoteEditor.status === 200, `got ${adminDemoteEditor.status}`);
  const restoredEditor = await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "editor" },
  });
  check("owner restores the editor role (200)", restoredEditor.status === 200);

  // ── 1. 邀请校验 ────────────────────────────────────────────────────────
  console.log("\n── 1. 邀请校验 ──");
  const badEmail = await req("POST", "/api/team/invite", {
    token: owner, body: { email: "not-an-email", role: "viewer" },
  });
  check("invalid email rejected (400)", badEmail.status === 400, `got ${badEmail.status}`);

  const dupInvite = await req("POST", "/api/team/invite", {
    token: owner, body: { email: "viewer@knowledgeai.dev", role: "viewer" },
  });
  check("duplicate email rejected (409)", dupInvite.status === 409, `got ${dupInvite.status}`);

  const ownerInviteOwner = await req("POST", "/api/team/invite", {
    token: owner, body: { email: `owner2-${Date.now()}@knowledgeai.dev`, role: "owner" },
  });
  check("second owner cannot be invited (403)", ownerInviteOwner.status === 403, `got ${ownerInviteOwner.status}`);

  const newInvite = await req("POST", "/api/team/invite", {
    token: owner, body: { email: `member-${Date.now()}@knowledgeai.dev`, role: "viewer" },
  });
  check("owner invites a viewer (201)", newInvite.status === 201, `got ${newInvite.status}`);
  if (newInvite.data?.member?.id) {
    const cleanup = await req("DELETE", `/api/team/members/${newInvite.data.member.id}`, { token: owner });
    check("owner removes the invited member (200)", cleanup.status === 200);
  }

  // ── 2. 角色变更即时生效（不是只改展示行） ─────────────────────────────
  console.log("\n── 2. 角色同步与即时生效 ──");
  const editorBefore = await req("GET", "/api/team", { token: editor });
  check("editor has no member.manage before promotion",
    !(editorBefore.data?.permissions ?? []).includes("member.manage"));
  check("editor cannot read audit before promotion", (editorBefore.data?.audit ?? []).length === 0);

  const promote = await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "admin" },
  });
  check("owner promotes editor to admin (200)", promote.status === 200, `got ${promote.status}`);
  const editorAsAdmin = await req("GET", "/api/team", { token: editor });
  check("existing editor token gains member.manage immediately",
    (editorAsAdmin.data?.permissions ?? []).includes("member.manage"));
  check("promoted admin now sees the audit trail", (editorAsAdmin.data?.audit ?? []).length > 0);

  const demoteBack = await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "editor" },
  });
  check("owner demotes back to editor (200)", demoteBack.status === 200);
  const editorAfter = await req("GET", "/api/team", { token: editor });
  check("same token loses member.manage immediately",
    !(editorAfter.data?.permissions ?? []).includes("member.manage"));

  // ── 3. KB 共享权限：管理者与库主────────────────────────────────────────
  console.log("\n── 3. 知识库共享权限 ──");
  const ownerKb = await req("POST", "/api/knowledge-base", {
    token: owner, body: { name: "team-admin-owner" },
  });
  const ownerKbId = ownerKb.data?.kb?.id;
  check("setup: owner creates a KB", !!ownerKbId, `${ownerKb.status}`);

  const editorKb = await req("POST", "/api/knowledge-base", {
    token: editor, body: { name: "team-admin-editor" },
  });
  const editorKbId = editorKb.data?.kb?.id;
  check("editor creates own KB", !!editorKbId, `${editorKb.status}`);

  const editorSetsOwnAccess = await req("PATCH", "/api/team/kb-access", {
    token: editor, body: { kbId: editorKbId, access: "private" },
  });
  check("KB owner (editor) can lock own KB (200)", editorSetsOwnAccess.status === 200, `got ${editorSetsOwnAccess.status}`);

  const editorSetsForeign = await req("PATCH", "/api/team/kb-access", {
    token: editor, body: { kbId: ownerKbId, access: "private" },
  });
  check("editor cannot change a foreign KB (403)", editorSetsForeign.status === 403, `got ${editorSetsForeign.status}`);

  const adminSetsForeign = await req("PATCH", "/api/team/kb-access", {
    token: admin, body: { kbId: ownerKbId, access: "edit" },
  });
  check("team admin can change shared access (200)", adminSetsForeign.status === 200, `got ${adminSetsForeign.status}`);
  await req("PATCH", "/api/team/kb-access", { token: owner, body: { kbId: ownerKbId, access: "view" } });

  const badAccess = await req("PATCH", "/api/team/kb-access", {
    token: owner, body: { kbId: ownerKbId, access: "public" },
  });
  check("unknown access level rejected (400)", badAccess.status === 400, `got ${badAccess.status}`);

  const adminMemberRole = await req("PATCH", "/api/team/kb-access", {
    token: admin, body: { kbId: editorKbId, email: "viewer@knowledgeai.dev", role: "viewer" },
  });
  check("non-owner admin cannot set member roles (403)", adminMemberRole.status === 403, `got ${adminMemberRole.status}`);

  const strangerRole = await req("PATCH", "/api/team/kb-access", {
    token: owner, body: { kbId: ownerKbId, email: "stranger@elsewhere.dev", role: "viewer" },
  });
  check("non-member email rejected (404)", strangerRole.status === 404, `got ${strangerRole.status}`);

  // ── 4. 成员级授权：可读、可撤销 ───────────────────────────────────────
  console.log("\n── 4. 成员级授权 ──");
  const grantViewer = await req("PATCH", "/api/team/kb-access", {
    token: editor, body: { kbId: editorKbId, email: "viewer@knowledgeai.dev", role: "viewer" },
  });
  check("KB owner grants viewer access (200)", grantViewer.status === 200, `got ${grantViewer.status}`);
  const viewerCanRead = await req("GET", `/api/knowledge-base/${editorKbId}`, { token: viewer });
  check("granted viewer can read the private KB (200)", viewerCanRead.status === 200, `got ${viewerCanRead.status}`);
  const clearGrant = await req("PATCH", "/api/team/kb-access", {
    token: editor, body: { kbId: editorKbId, email: "viewer@knowledgeai.dev", role: null },
  });
  check("KB owner clears the grant (200)", clearGrant.status === 200);
  const viewerDenied = await req("GET", `/api/knowledge-base/${editorKbId}`, { token: viewer });
  check("cleared grant revokes access (403)", viewerDenied.status === 403, `got ${viewerDenied.status}`);

  // ── 5. 授权映射不外泄 ─────────────────────────────────────────────────
  console.log("\n── 5. 授权映射可见性 ──");
  await req("PATCH", "/api/team/kb-access", {
    token: owner, body: { kbId: ownerKbId, email: "viewer@knowledgeai.dev", role: "viewer" },
  });
  const ownerView = await req("GET", "/api/team", { token: owner });
  const ownerRow = (ownerView.data?.sharedKbs ?? []).find((r: any) => r.kbId === ownerKbId);
  check("owner sees the member role map",
    ownerRow?.memberRoles?.["viewer@knowledgeai.dev"] === "viewer", JSON.stringify(ownerRow?.memberRoles));

  const viewerView = await req("GET", "/api/team", { token: viewer });
  const viewerRow = (viewerView.data?.sharedKbs ?? []).find((r: any) => r.kbId === ownerKbId);
  check("plain member does not receive the email -> role map",
    viewerRow && Object.keys(viewerRow.memberRoles ?? {}).length === 0, JSON.stringify(viewerRow?.memberRoles));
  check("plain member still sees the grant count", (viewerRow?.memberRoleCount ?? 0) >= 1);
  check("plain member does not receive member.manage",
    !(viewerView.data?.permissions ?? []).includes("member.manage"));

  // ── 6. 封禁即时生效 ──────────────────────────────────────────────────
  console.log("\n── 6. 封禁即时生效 ──");
  const viewerMe = await req("GET", "/api/auth/me", { token: viewer });
  const viewerId = viewerMe.data?.user?.id ?? viewerMe.data?.id;
  check("setup: viewer id resolved", !!viewerId);
  if (viewerId) {
    const ban = await req("PATCH", `/api/admin/users/${viewerId}`, { token: admin, body: { status: "banned" } });
    check("admin bans the viewer (200)", ban.status === 200, `got ${ban.status}`);
    const bannedRequest = await req("GET", "/api/team", { token: viewer });
    check("banned user's live token rejected (401)", bannedRequest.status === 401, `got ${bannedRequest.status}`);
    const bannedLogin = await login("viewer@knowledgeai.dev");
    check("banned user cannot log in (403)", bannedLogin.status === 403, `got ${bannedLogin.status}`);
    const unban = await req("PATCH", `/api/admin/users/${viewerId}`, { token: admin, body: { status: "active" } });
    check("admin unbans the viewer (200)", unban.status === 200);
    const relogin = await login("viewer@knowledgeai.dev");
    check("unbanned user can log in again (200)", relogin.status === 200 && !!relogin.token, `got ${relogin.status}`);
  }

  // ── 7. 清理：还原授权映射，避免影响后续脚本 ───────────────────────────
  console.log("\n── 7. 清理 ──");
  const cleanupGrant = await req("PATCH", "/api/team/kb-access", {
    token: owner, body: { kbId: ownerKbId, email: "viewer@knowledgeai.dev", role: null },
  });
  check("cleanup: member role grant cleared", cleanupGrant.status === 200, `got ${cleanupGrant.status}`);
  const cleanupAccess = await req("PATCH", "/api/team/kb-access", {
    token: owner, body: { kbId: ownerKbId, access: "view" },
  });
  check("cleanup: shared access restored", cleanupAccess.status === 200, `got ${cleanupAccess.status}`);

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
