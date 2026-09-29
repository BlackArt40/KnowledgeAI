import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/auth/me/route";

describe("GET /api/auth/me", () => {
  it("returns 401 when the request has no valid session", async () => {
    const res = await GET(new Request("http://localhost/api/auth/me"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ user: null });
  });
});
