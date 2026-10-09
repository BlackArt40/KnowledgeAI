// 退出登录必须真正结束会话：清掉 httpOnly cookie（前端 JS 删不掉）并把当前
// JWT 的 jti 拉黑。此前 logout 只清了 localStorage → 7 天 token 继续有效，
// 配合 /login 的"已登录自动进工作台"守卫，点退出登录会被直接弹回工作台。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/logout/route";
import { createToken, isJtiRevoked, verifyToken } from "@/lib/auth/session";
import { __resetJtiStateForTest } from "@/lib/auth/jti-shared";

const USER = { id: "usr_logout", email: "logout@knowledgeai.dev", name: "登出测试", role: "editor" as const };

function logoutRequest(token?: string) {
  return new Request("http://localhost/api/auth/logout", {
    method: "POST",
    headers: token ? { cookie: `kai-token=${token}` } : {},
  });
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_REVOKED_JTI__;
  // Never let a developer-machine REDIS_URL leak into these unit tests.
  vi.stubEnv("REDIS_URL", "");
  __resetJtiStateForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetJtiStateForTest();
});

describe("POST /api/auth/logout", () => {
  it("吊销当前会话（token 立即失效）并返回清 cookie 指令", async () => {
    const token = await createToken(USER, 3600, { jti: "ses_logout_case" });
    expect(await verifyToken(token)).not.toBeNull();

    const res = await POST(logoutRequest(token));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    // jti blacklisted -> the same token is now rejected everywhere.
    expect(isJtiRevoked("ses_logout_case")).toBe(true);
    expect(await verifyToken(token)).toBeNull();
    // Cookie deletion: same name + path, expired immediately.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kai-token=");
    expect(setCookie.toLowerCase()).toContain("max-age=0");
    expect(setCookie).toContain("Path=/");
  });

  it("未携带会话时幂等返回 200，并同样清理残留 cookie", async () => {
    const res = await POST(logoutRequest());

    expect(res.status).toBe(200);
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("max-age=0");
  });

  it("无效 token 不吊销任何东西，但仍清 cookie", async () => {
    const res = await POST(logoutRequest("not-a-jwt"));

    expect(res.status).toBe(200);
    expect(isJtiRevoked("ses_logout_case")).toBe(false);
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("max-age=0");
  });
});
