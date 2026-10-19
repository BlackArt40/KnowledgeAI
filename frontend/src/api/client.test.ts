// API 客户端行为契约：JSON 解析 / 错误形状 / 401 跳转豁免（认证接口除外）。
// 401 跳转依赖 window（node 环境无 window，仅验证不抛非 ApiError）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./client";

function stubFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("parses JSON responses on 2xx", async () => {
    vi.stubGlobal("fetch", stubFetch(200, { ok: true, id: 7 }));
    await expect(request<{ ok: boolean; id: number }>("/api/auth/me")).resolves.toEqual({
      ok: true,
      id: 7,
    });
  });

  it("throws ApiError carrying status + server code on non-2xx", async () => {
    vi.stubGlobal("fetch", stubFetch(403, { error: "forbidden", code: "FORBIDDEN" }));
    await expect(request("/api/admin/users")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("treats auth endpoints as 401-exempt (login page owns the error)", async () => {
    vi.stubGlobal("fetch", stubFetch(401, { error: "bad credentials" }));
    await expect(request("/api/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(
      ApiError
    );
  });
});
