import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportClientError", () => {
  it("同一 message 30s 内只上报一次", async () => {
    const { reportClientError } = await import("./error-reporter");
    expect(reportClientError("boom")).toBe(true);
    expect(reportClientError("boom")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("不同来源的同名错误分别计一次", async () => {
    const { reportClientError } = await import("./error-reporter");
    expect(reportClientError("boom", undefined, "window")).toBe(true);
    expect(reportClientError("boom", undefined, "promise")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("空 message 不上报", async () => {
    const { reportClientError } = await import("./error-reporter");
    expect(reportClientError("   ")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
