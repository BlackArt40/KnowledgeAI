// P6-3 unit tests: rag/fetcher (URL -> readable text, mocked fetch).
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchUrlContent } from "./fetcher";

const html = `<html><head><title>示例 &amp; 标题</title></head><body>
<script>var x = 1;</script>
<p>这是一段足够长的正文内容用于测试网页抓取，包含 script 与 style 块需要被剥离，正文必须超过四十个字符才能通过校验。</p>
</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
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
});
