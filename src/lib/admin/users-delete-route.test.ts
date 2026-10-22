import { beforeEach, describe, expect, it } from "vitest";
import { DELETE } from "@/app/api/admin/users/[id]/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { createToken } from "@/lib/auth/session";
import { createUser, getUserById, seed as seedUsers, type User } from "@/lib/auth/store";
import { ensurePersonalWorkspace, listOwnedWorkspaces } from "@/lib/workspace/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };

async function cookieFor(user: { id: string; email: string; name: string; role: Role }): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}

function delRequest(id: string, cookie: string): Request {
  return new Request(`http://localhost/api/admin/users/${id}`, { method: "DELETE", headers: { cookie } });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function createTarget(email: string): Promise<User> {
  const created = await createUser("待删账号", email, "password123", "editor");
  if ("error" in created) throw new Error(created.error);
  ensurePersonalWorkspace({ ownerId: created.id, ownerEmail: created.email, ownerName: created.name });
  return created;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_WORKSPACE_STORE__;
  seedUsers();
});

describe("DELETE /api/admin/users/[id]", () => {
  it("未登录 401 / 非管理员 403", async () => {
    const anon = await DELETE(delRequest("usr_viewer", ""), params("usr_viewer"));
    expect(anon.status).toBe(401);

    const editorCookie = await cookieFor({
      id: "usr_editor",
      email: "editor@knowledgeai.dev",
      name: "王浩（Editor）",
      role: "editor",
    });
    const forbidden = await DELETE(delRequest("usr_viewer", editorCookie), params("usr_viewer"));
    expect(forbidden.status).toBe(403);

    // 删号不可逆，权限级别高于可逆的封禁：admin 也不能删（仅 Owner）
    const adminCookie = await cookieFor({
      id: "usr_admin",
      email: "admin@knowledgeai.dev",
      name: "李芳（Admin）",
      role: "admin",
    });
    const adminForbidden = await DELETE(delRequest("usr_viewer", adminCookie), params("usr_viewer"));
    expect(adminForbidden.status).toBe(403);
  });

  it("拒绝删除自己 / 拒绝删除 Owner / 目标不存在 404", async () => {
    const ownerCookie = await cookieFor(OWNER);

    const self = await DELETE(delRequest(OWNER.id, ownerCookie), params(OWNER.id));
    expect(self.status).toBe(400);

    // 另一个 Owner 也不可删（团队会失去所有者，需先转移）
    const secondOwner = await createUser("第二 Owner", "owner2@test.local", "password123", "owner");
    if ("error" in secondOwner) throw new Error(secondOwner.error);
    const ownerTarget = await DELETE(delRequest(secondOwner.id, ownerCookie), params(secondOwner.id));
    expect(ownerTarget.status).toBe(403);

    const missing = await DELETE(delRequest("usr_missing", ownerCookie), params("usr_missing"));
    expect(missing.status).toBe(404);
  });

  it("删除普通用户：清掉个人工作区与成员关系", async () => {
    const target = await createTarget("delete-me@test.local");
    expect(listOwnedWorkspaces(target.id)).toHaveLength(1);

    const res = await DELETE(delRequest(target.id, await cookieFor(OWNER)), params(target.id));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, id: target.id });

    expect(getUserById(target.id)).toBeNull();
    expect(listOwnedWorkspaces(target.id)).toHaveLength(0);
  });

  it("删除后吊销目标用户已签发的 JWT（旧 token 立即 401）", async () => {
    const target = await createTarget("revoke-me@test.local");
    // 目标用户自己的（已过期的 7 天）token —— 在删号前签发
    const staleCookie = `kai-token=${await createToken(
      { id: target.id, email: target.email, name: target.name, role: target.role },
      60
    )}`;
    const before = await meGET(
      new Request("http://localhost/api/auth/me", { headers: { cookie: staleCookie } })
    );
    expect(before.status).toBe(200);

    const res = await DELETE(delRequest(target.id, await cookieFor(OWNER)), params(target.id));
    expect(res.status).toBe(200);

    const after = await meGET(
      new Request("http://localhost/api/auth/me", { headers: { cookie: staleCookie } })
    );
    expect(after.status).toBe(401);
    await expect(after.json()).resolves.toEqual({ user: null });
  });
});
