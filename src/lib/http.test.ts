// 守卫型 JSON fetch：非 2xx / 网络失败 / 非 JSON 体一律返回 null，绝不把
// {error:...} 之类的错误体交给调用方（那会让页面渲染期崩溃，见 PR #32 复盘）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./http";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("OK 响应返回解析后的数据", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ tasks: [1, 2] })));
    await expect(fetchJson<{ tasks: number[] }>("/api/agent/tasks")).resolves.toEqual({ tasks: [1, 2] });
  });

  it("非 OK 响应返回 null（错误体不落到调用方）", async () => {
    // 429 的实际响应体形状
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "请求过于频繁，请稍后再试", retryAfter: 30, dimension: "user" }, 429))
    );
    await expect(fetchJson("/api/knowledge-base")).resolves.toBeNull();
  });

  it("401 / 500 同样返回 null", async () => {
    for (const status of [401, 500]) {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, status)));
      await expect(fetchJson("/api/admin")).resolves.toBeNull();
    }
  });

  it("网络异常返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(fetchJson("/api/usage")).resolves.toBeNull();
  });

  it("响应体不是 JSON 时返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 200 })));
    await expect(fetchJson("/api/usage")).resolves.toBeNull();
  });
});
