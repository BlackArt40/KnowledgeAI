// 团队邀请闭环：签名 token、席位校验、接受/拒绝的邮箱归属与副作用。
import { beforeEach, describe, expect, it } from "vitest";
import { signInviteToken, verifyInviteToken } from "@/lib/team/invite-token";
import { POST as invitePOST } from "@/app/api/team/invite/route";
import { POST as acceptPOST } from "@/app/api/team/invite/accept/route";
import { POST as rejectPOST } from "@/app/api/team/invite/reject/route";
import { createToken } from "@/lib/auth/session";
import { createUser, seed as seedUsers } from "@/lib/auth/store";
import { findMemberByEmail, listMembers } from "@/lib/team/store";
import { getDefaultWorkspace, setWorkspacePlan, workspaceOf } from "@/lib/workspace/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };

async function cookieFor(user: { id: string; email: string; name: string; role: Role }): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}
function jsonRequest(cookie: string, path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function invite(ownerCookie: string, email: string, role = "viewer") {
  const res = await invitePOST(jsonRequest(ownerCookie, "/api/team/invite", { email, role }));
  const body = (await res!.json()) as { inviteUrl?: string; error?: string; code?: string };
  return { status: res!.status, body };
}
function tokenFrom(url?: string): string {
  return url ? new URL(url).searchParams.get("token") ?? "" : "";
}

beforeEach(() => {
  for (const key of ["__KAI_TEAM_STORE__", "__KAI_USER_STORE__", "__KAI_WORKSPACE_STORE__"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seedUsers();
});

describe("邀请 token", () => {
  it("签名可验证；篡改与过期被拒", () => {
    const token = signInviteToken({ email: "A@Test.local", role: "editor", workspaceId: "ws_1" }, 60_000);
    const ok = verifyInviteToken(token);
    expect(ok).toMatchObject({ ok: true, payload: { email: "a@test.local", role: "editor", workspaceId: "ws_1" } });

    expect(verifyInviteToken(`${token}x`).ok).toBe(false);
    const expired = signInviteToken({ email: "a@test.local", role: "viewer", workspaceId: "ws_1" }, -1);
    expect(verifyInviteToken(expired)).toMatchObject({ ok: false, reason: "expired" });
  });
});

describe("邀请接口与接受/拒绝", () => {
  it("席位满时拒绝邀请（free=1）", async () => {
    setWorkspacePlan(getDefaultWorkspace().id, "free");
    const owner = await cookieFor(OWNER);
    const res = await invite(owner, "seat@test.local");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("seats_full");
  });

  it("邀请返回链接；被邀请账号可接受并加入工作区", async () => {
    const owner = await cookieFor(OWNER);
    const invitee = await createUser("受邀者", "invitee@test.local", "password123", "viewer");
    if ("error" in invitee) throw new Error(invitee.error);

    const res = await invite(owner, invitee.email);
    expect(res.status).toBe(201);
    const token = tokenFrom(res.body.inviteUrl);
    expect(token).not.toBe("");

    // 邮箱不匹配不能接受
    const wrongUser = await cookieFor({ ...OWNER, id: "usr_editor", email: "editor@knowledgeai.dev", name: "王浩", role: "editor" });
    const wrong = await acceptPOST(jsonRequest(wrongUser, "/api/team/invite/accept", { token }));
    expect(wrong!.status).toBe(403);

    const inviteeCookie = await cookieFor({ ...invitee, role: "viewer" });
    const accepted = await acceptPOST(jsonRequest(inviteeCookie, "/api/team/invite/accept", { token }));
    expect(accepted!.status).toBe(200);
    expect(findMemberByEmail(invitee.email)?.status).toBe("active");
    expect(workspaceOf(getDefaultWorkspace().id, invitee.email)).toBe(true);
  });

  it("拒绝邀请会移除 pending 成员行", async () => {
    const owner = await cookieFor(OWNER);
    const invitee = await createUser("拒绝者", "decliner@test.local", "password123", "viewer");
    if ("error" in invitee) throw new Error(invitee.error);

    const res = await invite(owner, invitee.email);
    const token = tokenFrom(res.body.inviteUrl);
    const inviteeCookie = await cookieFor({ ...invitee, role: "viewer" });

    const rejected = await rejectPOST(jsonRequest(inviteeCookie, "/api/team/invite/reject", { token }));
    expect(rejected!.status).toBe(200);
    expect(findMemberByEmail(invitee.email)).toBeUndefined();
    expect(listMembers().some((m) => m.email === invitee.email)).toBe(false);
    // 再次拒绝：没有 pending 行
    const again = await rejectPOST(jsonRequest(inviteeCookie, "/api/team/invite/reject", { token }));
    expect(again!.status).toBe(409);
  });
});
