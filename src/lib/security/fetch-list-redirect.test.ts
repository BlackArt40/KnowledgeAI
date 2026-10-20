// P0 regression: /api/models/fetch-list used to validate the original baseUrl
// but then fetch it with the default redirect:"follow", so a public host could
// 302 the server into the cloud metadata service. It also echoed the first
// 200 chars of non-2xx bodies back to the caller.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  default: { lookup: (...args: unknown[]) => lookup(...args) },
}));

vi.mock("@/lib/auth/guard", () => ({
  getRequestUser: vi.fn(async () => ({
    id: "usr_1",
    email: "user@example.dev",
    name: "User",
    role: "editor",
    workspaceId: "ws_default",
  })),
}));

import { POST } from "@/app/api/models/fetch-list/route";

const fetchMock = vi.fn();

function request(body: unknown): Request {
  return new Request("http://localhost/api/models/fetch-list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Public address until a test overrides it.
  lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.LLM_ALLOW_PRIVATE_BASE_URL;
  delete process.env.SSRF_ALLOW_PRIVATE_HOSTS;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/models/fetch-list SSRF", () => {
  it("rejects a redirect to the cloud metadata service", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );

    const res = await POST(request({ baseUrl: "https://public.example.com/v1" }));
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain("云元数据");
    // The blocked hop must never be requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never echoes the upstream error body", async () => {
    fetchMock.mockResolvedValue(new Response("secret internal response", { status: 401 }));

    const res = await POST(request({ baseUrl: "https://public.example.com/v1" }));
    const data = (await res.json()) as { error?: string };

    expect(data.error).toBe("HTTP 401");
    expect(JSON.stringify(data)).not.toContain("secret internal");
  });
});
