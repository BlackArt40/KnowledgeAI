// P6-3 unit tests: auth/guard (request auth + RBAC on constructed Requests).
import { describe, it, expect } from "vitest";
import { getRequestUser, requireRole } from "./guard";
import { createToken, type AuthUser } from "./session";

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

  it("rejects mismatched roles with 403", async () => {
    const token = await createToken({ ...user, role: "editor" });
    const guard = await requireRole(reqWith({ cookie: `kai-token=${token}` }), ["owner", "admin"]);
    expect(guard.error?.status).toBe(403);
  });
});
