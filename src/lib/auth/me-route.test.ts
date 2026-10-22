import { describe, expect, it } from "vitest";
import { DELETE, GET } from "@/app/api/auth/me/route";
import { createToken } from "@/lib/auth/session";
import { listAudit, verifyAuditChain } from "@/lib/security/audit";
import { createWorkspace, getWorkspace } from "@/lib/workspace/store";
import type { Role } from "@/lib/roles";

const OWNER = {
  id: "usr_owner",
  email: "owner@knowledgeai.dev",
  name: "张明（Owner）",
  role: "owner" as Role,
};

async function cookieFor(user: typeof OWNER, workspaceId?: string): Promise<string> {
  const token = await createToken(user, 60);
  return [`kai-token=${token}`, workspaceId ? `kai-workspace=${workspaceId}` : ""]
    .filter(Boolean)
    .join("; ");
}

function meRequest(cookie: string): Request {
  return new Request("http://localhost/api/auth/me", { headers: { cookie } });
}

describe("GET /api/auth/me", () => {
  it("returns 401 when the request has no valid session", async () => {
    const res = await GET(new Request("http://localhost/api/auth/me"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ user: null });
  });

  it("返回工作区生效套餐而不是 users.plan（种子 owner 的 user.plan=enterprise，工作区=pro）", async () => {
    const res = await GET(meRequest(await cookieFor(OWNER)));
    const body = (await res.json()) as { user: { plan: string } };

    expect(res.status).toBe(200);
    expect(getWorkspace("ws_default")?.plan).toBe("pro");
    expect(body.user.plan).toBe("pro");
  });

  it("按 kai-workspace cookie 解析当前租户的套餐", async () => {
    const ws = createWorkspace({
      name: "单测工作区",
      ownerId: OWNER.id,
      ownerEmail: OWNER.email,
      ownerName: OWNER.name,
      memberEmails: [],
    });
    expect(ws.plan).toBe("free");

    const res = await GET(meRequest(await cookieFor(OWNER, ws.id)));
    const body = (await res.json()) as { user: { plan: string } };

    expect(body.user.plan).toBe("free");
  });
});

describe("DELETE /api/auth/me（自助删号）", () => {
  it("写审计链（account.delete）且链完整", async () => {
    // editor 不是 owner，允许自助删号；owner 会被 403（团队不能失去所有者）
    const target = {
      id: "usr_editor",
      email: "editor@knowledgeai.dev",
      name: "王浩（Editor）",
      role: "editor" as Role,
    };
    const cookie = `kai-token=${await createToken(target, 60)}`;

    const res = await DELETE(new Request("http://localhost/api/auth/me", { method: "DELETE", headers: { cookie } }));
    expect(res.status).toBe(200);

    const { audit } = listAudit({ action: "account.delete" });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: target.id,
      actor: target.name,
      action: "account.delete",
      target: target.email,
    });
    // 哈希链仍然可校验（没有把链写坏）
    expect(verifyAuditChain().valid).toBe(true);
  });

  it("Owner 自助删号 403（团队不能失去所有者），且不产生审计记录", async () => {
    const before = listAudit({ action: "account.delete" }).total;
    const res = await DELETE(
      new Request("http://localhost/api/auth/me", {
        method: "DELETE",
        headers: { cookie: `kai-token=${await createToken(OWNER, 60)}` },
      })
    );
    expect(res.status).toBe(403);
    expect(listAudit({ action: "account.delete" }).total).toBe(before);
  });
});
