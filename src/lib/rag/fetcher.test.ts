// P6-3 unit tests: rag/fetcher (URL -> readable text, mocked fetch).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns/promises";
import { fetchUrlContent } from "./fetcher";

const html = `<html><head><title>示例 &amp; 标题</title></head><body>
<script>var x = 1;</script>
<p>这是一段足够长的正文内容用于测试网页抓取，包含 script 与 style 块需要被剥离，正文必须超过四十个字符才能通过校验。</p>
</body></html>`;

beforeEach(() => {
  // P0-4 SSRF: resolveSafeUrl performs a real DNS lookup - stub it to a
  // public address so tests stay deterministic (no network dependency).
  vi.spyOn(dns, "lookup").mockImplementation((async () => [{ address: "93.184.216.34", family: 4 }]) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(impl: () => Promise<Partial<Response>>) {
  vi.stubGlobal("fetch", vi.fn(impl as never));
}

describe("fetchUrlContent", () => {
  it("fetches html, strips scripts/styles and decodes entities", async () => {
    mockFetch(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    }));
    const out = await fetchUrlContent("https://example.com/page");
    expect(out).not.toBeNull();
    expect(out!.title).toBe("示例 & 标题");
    expect(out!.text).toContain("正文内容");
    expect(out!.text).not.toContain("var x");
    expect(out!.text).not.toContain("<p>");
  });

  it("returns null for non-html content types", async () => {
    mockFetch(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => html,
    }));
    expect(await fetchUrlContent("https://example.com/data.json")).toBeNull();
  });

  it("returns null on HTTP errors", async () => {
    mockFetch(async () => ({ ok: false, headers: new Headers({ "content-type": "text/html" }) }));
    expect(await fetchUrlContent("https://example.com/404")).toBeNull();
  });

  it("returns null when the extracted body is too short", async () => {
    mockFetch(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html><body>short</body></html>",
    }));
    expect(await fetchUrlContent("https://example.com/tiny")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });
    expect(await fetchUrlContent("https://example.com/down")).toBeNull();
  });

  // ── P0-4 SSRF ──────────────────────────────────────────────────────────

  it("blocks private IP literals (loopback / metadata / RFC1918)", async () => {
    mockFetch(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    }));
    expect(await fetchUrlContent("http://127.0.0.1/admin")).toBeNull();
    expect(await fetchUrlContent("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(await fetchUrlContent("http://10.0.0.1/")).toBeNull();
    expect(await fetchUrlContent("http://192.168.1.1/")).toBeNull();
    expect(await fetchUrlContent("http://[::1]/")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks hostnames resolving to a private address (localhost)", async () => {
    mockFetch(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    }));
    vi.spyOn(dns, "lookup").mockImplementation((async () => [{ address: "127.0.0.1", family: 4 }]) as never);
    expect(await fetchUrlContent("http://internal.local/")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks redirects that bounce to a private address", async () => {
    mockFetch(async () => ({
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }),
      text: async () => "",
    }));
    expect(await fetchUrlContent("https://example.com/redirect")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // only the first hop - no second fetch
  });

  it("follows redirects that stay on public hosts", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls === 1) return { status: 301, headers: new Headers({ location: "https://example.com/final" }), text: async () => "" };
      return { ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => html };
    });
    const out = await fetchUrlContent("https://example.com/start");
    expect(out).not.toBeNull();
    expect(out!.text).toContain("正文内容");
  });

  it("gives up after too many redirect hops", async () => {
    mockFetch(async () => ({
      status: 302,
      headers: new Headers({ location: "https://example.com/again" }),
      text: async () => "",
    }));
    expect(await fetchUrlContent("https://example.com/loop")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(6); // initial + MAX_SSRF_REDIRECTS (5)
  });
});
