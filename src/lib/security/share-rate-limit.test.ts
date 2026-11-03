// 公开分享端点必须限流：未认证 + 可猜密码/枚举 token。
import { describe, expect, it, vi } from "vitest";

const limited = vi.hoisted(() => ({ allowed: false, limit: 60, remaining: 0, resetAt: Date.now() + 60_000, count: 61 }));
const allowed = vi.hoisted(() => ({ allowed: true, limit: 60, remaining: 59, resetAt: Date.now() + 60_000, count: 1 }));

const shareLimitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rate-limit", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, publicShareRateLimit: shareLimitMock };
});

import { GET as kbShareGET } from "@/app/api/share/kb/[token]/route";
import { GET as docShareGET } from "@/app/api/share/doc/[token]/route";
import { GET as agentPublicGET } from "@/app/api/agent/public/[id]/route";

// 左侧是客户端可伪造的，只应采信右侧最近一跳（TRUSTED_PROXY_HOPS=1）
const req = new Request("http://localhost/x", {
  headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
});
const kbParams = { params: Promise.resolve({ token: "nope" }) };
const docParams = { params: Promise.resolve({ token: "nope" }) };
const agentParams = { params: Promise.resolve({ id: "task_nope" }) };

describe("公开分享端点限流", () => {
  it("超限时三个入口都返回 429（dimension=share）", async () => {
    shareLimitMock.mockResolvedValue(limited);
    for (const res of [
      await kbShareGET(req, kbParams),
      await docShareGET(req, docParams),
      await agentPublicGET(req, agentParams),
    ]) {
      expect(res!.status).toBe(429);
      await expect(res!.json()).resolves.toMatchObject({ dimension: "share" });
    }
    expect(shareLimitMock).toHaveBeenCalledWith("203.0.113.7");
  });

  it("未超限时继续到业务层（未知 token 仍为 404）", async () => {
    shareLimitMock.mockResolvedValue(allowed);
    expect((await kbShareGET(req, kbParams))!.status).toBe(404);
    expect((await docShareGET(req, docParams))!.status).toBe(404);
    expect((await agentPublicGET(req, agentParams))!.status).toBe(404);
  });
});
