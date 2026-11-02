// P6-3 unit tests: auth/guard (request auth + RBAC on constructed Requests).
import { describe, it, expect } from "vitest";
import { getRequestUser, requireRole } from "./guard";
import { createToken, type AuthUser } from "./session";
import { createKey, deleteKey } from "@/lib/apikeys/store";

const user: AuthUser = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "Owner", role: "owner" };

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

describe("getRequestUser", () => {
  it("resolves identity from the kai-token cookie", async () => {
    const token = await createToken(user);
    const u = await getRequestUser(reqWith({ cookie: `kai-token=${token}` }));
    expect(u?.id).toBe("usr_owner");
    expect(u?.role).toBe("owner");
    expect(typeof u?.workspaceId).toBe("string");
  });

  it("resolves identity from a Bearer token", async () => {
    const token = await createToken(user);
    const u = await getRequestUser(reqWith({ authorization: `Bearer ${token}` }));
    expect(u?.id).toBe("usr_owner");
  });

  it("returns null with no credentials or invalid tokens", async () => {
    expect(await getRequestUser(reqWith({}))).toBeNull();
    expect(await getRequestUser(reqWith({ cookie: "kai-token=garbage" }))).toBeNull();
  });

  it("returns null for unknown API keys", async () => {
    const u = await getRequestUser(reqWith({ authorization: "Bearer kai_sk_doesnotexist123" }));
    expect(u).toBeNull();
  });

  it("rejects valid API keys unless the route explicitly opts in", async () => {
    const key = createKey("guard-api-key", ["chat:read"], user.id);
    const req = reqWith({ authorization: `Bearer ${key.secret}` });
    try {
      expect(await getRequestUser(req)).toBeNull();
      expect((await getRequestUser(req, { allowApiKey: true }))?.id).toBe(user.id);
    } finally {
      deleteKey(key.id, user.id);
    }
  });
});

describe("requireRole", () => {
  it("allows matching roles", async () => {
    const token = await createToken(user);
    const guard = await requireRole(reqWith({ cookie: `kai-token=${token}` }), ["owner", "admin"]);
    expect(guard.error).toBeNull();
    expect(guard.user?.id).toBe("usr_owner");
  });

  it("rejects anonymous with 401", async () => {
    const guard = await requireRole(reqWith({}), ["owner"]);
    expect(guard.error?.status).toBe(401);
  });

  it("rejects mismatched roles with 403 (live account wins over token claim)", async () => {
    // The JWT claims owner, but usr_editor is an editor in the account store:
    // authorization must follow the live role, not a stale/forged claim.
    const token = await createToken({
      ...user,
      id: "usr_editor",
      email: "editor@knowledgeai.dev",
      role: "owner",
    });
    const guard = await requireRole(reqWith({ cookie: `kai-token=${token}` }), ["owner", "admin"]);
    expect(guard.error?.status).toBe(403);
  });
});

describe("banned accounts", () => {
  it("a live token stops working immediately after a ban", async () => {
    const { setUserStatus } = await import("./store");
    const editor = { ...user, id: "usr_editor", email: "editor@knowledgeai.dev", role: "editor" as const };
    const token = await createToken(editor);
    try {
      setUserStatus("usr_editor", "banned");
      expect(await getRequestUser(reqWith({ cookie: `kai-token=${token}` }))).toBeNull();
    } finally {
      setUserStatus("usr_editor", "active");
    }
    expect((await getRequestUser(reqWith({ cookie: `kai-token=${token}` })))?.id).toBe("usr_editor");
  });
});
