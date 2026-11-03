// Workspace 成员管理的权限与边界：
//   - 非所有者只读；成员才能查看工作区
//   - 只有工作区所有者能增删成员；所有者不可被移除
//   - 只能添加已激活的团队成员
import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as membersGET,
  POST as membersPOST,
  DELETE as membersDELETE,
} from "@/app/api/workspaces/members/route";
import { createToken } from "@/lib/auth/session";
import { seed as seedUsers } from "@/lib/auth/store";
import { getDefaultWorkspace, createWorkspace } from "@/lib/workspace/store";
import { getMember, inviteMember } from "@/lib/team/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };
const EDITOR = { id: "usr_editor", email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "editor" as Role };

async function cookieFor(user: typeof OWNER): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}

function jsonRequest(cookie: string, method: string, body: unknown): Request {
  return new Request("http://localhost/api/workspaces/members", {
    method,
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(cookie: string, query = ""): Request {
  return new Request(`http://localhost/api/workspaces/members${query}`, { headers: { cookie } });
}

function deleteRequest(cookie: string, email: string): Request {
  const qs = new URLSearchParams({ email });
  return new Request(`http://localhost/api/workspaces/members?${qs}`, { method: "DELETE", headers: { cookie } });
}

beforeEach(() => {
  for (const key of ["__KAI_WORKSPACE_STORE__", "__KAI_USER_STORE__", "__KAI_TEAM_STORE__"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seedUsers();
});

describe("/api/workspaces/members", () => {
  it("成员可读、非所有者 canManage=false；非成员工作区 403", async () => {
    const owner = await cookieFor(OWNER);
    const editor = await cookieFor(EDITOR);

    const asOwner = await membersGET(getRequest(owner));
    expect(asOwner!.status).toBe(200);
    const ownerBody = (await asOwner!.json()) as { canManage: boolean; members: { email: string }[] };
    expect(ownerBody.canManage).toBe(true);
    expect(ownerBody.members.some((m) => m.email === EDITOR.email)).toBe(true);

    const asEditor = await membersGET(getRequest(editor));
    expect(asEditor!.status).toBe(200);
    await expect(asEditor!.json()).resolves.toMatchObject({ canManage: false });

    // 非成员工作区不可见
    const other = createWorkspace({ name: "另一个工作区", ownerId: "usr_admin", ownerEmail: "admin@knowledgeai.dev", ownerName: "李芳" });
    const forbidden = await membersGET(getRequest(editor, `?workspaceId=${other.id}`));
    expect(forbidden!.status).toBe(403);
  });

  it("只有所有者能增删；只能添加已激活的团队成员；所有者不可移除", async () => {
    const owner = await cookieFor(OWNER);
    const editor = await cookieFor(EDITOR);
    const ws = getDefaultWorkspace();

    const editorAdd = await membersPOST(jsonRequest(editor, "POST", { email: "someone@test.local" }));
    expect(editorAdd!.status).toBe(403);

    const notTeam = await membersPOST(jsonRequest(owner, "POST", { email: "outside@test.local" }));
    expect(notTeam!.status).toBe(400);

    // 邀请后仍是 invited，不能直接加入工作区
    const invited = inviteMember({ name: "", email: "pending@test.local", role: "viewer" });
    const pendingAdd = await membersPOST(jsonRequest(owner, "POST", { email: invited.email }));
    expect(pendingAdd!.status).toBe(400);

    // 激活后可加入
    getMember(invited.id)!.status = "active";
    const added = await membersPOST(jsonRequest(owner, "POST", { email: invited.email }));
    expect(added!.status).toBe(201);

    const afterAdd = (await (await membersGET(getRequest(owner)))!.json()) as { members: { email: string }[] };
    expect(afterAdd.members.some((m) => m.email === invited.email)).toBe(true);

    const duplicate = await membersPOST(jsonRequest(owner, "POST", { email: invited.email }));
    expect(duplicate!.status).toBe(409);

    const removeOwner = await membersDELETE(deleteRequest(owner, OWNER.email));
    expect(removeOwner!.status).toBe(400);

    const removed = await membersDELETE(deleteRequest(owner, invited.email));
    expect(removed!.status).toBe(200);
    const afterRemove = (await (await membersGET(getRequest(owner)))!.json()) as { members: { email: string }[] };
    expect(afterRemove.members.some((m) => m.email === invited.email)).toBe(false);

    const missing = await membersDELETE(deleteRequest(owner, invited.email));
    expect(missing!.status).toBe(404);
    expect(ws.members.includes(invited.email)).toBe(false);
  });
});
