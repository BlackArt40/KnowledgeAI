import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/auth/me/route";
import { createToken } from "@/lib/auth/session";
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
