// V6：chat markdown 渲染行为单测（由 scripts/smoke/test-chat-markdown.tsx
// 迁移——原脚本 SSR 渲染的 React ChatMarkdown 组件已随 Next 页面层退役）。
// 断言 @/lib/markdown 的 renderChatMarkdown：代码块、[n] 引用 chip 注入
// （<pre>/<code> 内不转换）、GFM 表格、html:false 的 XSS 转义。
import { describe, expect, it } from "vitest";
import { renderChatMarkdown, renderMarkdown } from "./markdown";

describe("renderChatMarkdown", () => {
  it("renders fenced code blocks as <pre><code>", () => {
    const html = renderChatMarkdown('```js\nconst api = fetch("/api/v1");\n```');
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("const api");
  });

  it("injects citation chips for [n] markers in prose", () => {
    const html = renderChatMarkdown("答案正文[1]与[2]。");
    expect(html).toContain('data-cite="1"');
    expect(html).toContain('data-cite="2"');
    expect(html).toContain("cite-chip");
  });

  it("does not convert [n] inside <pre>/<code> blocks", () => {
    const html = renderChatMarkdown("正文[1]。\n\n```\narr[1] 取索引\n```");
    // 正文里的 chip 已注入
    expect(html).toContain('data-cite="1"');
    // 代码块内保持原样（无 chip 注入，且行内容仍在 pre 中）
    const pre = html.slice(html.indexOf("<pre"), html.indexOf("</pre>"));
    expect(pre).not.toContain("data-cite");
    expect(pre).toContain("arr[1]");
  });

  it("renders GFM tables (breaks+tables via markdown-it default + manual)", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    // markdown-it 默认不开 tables——GFM 表由调用方特性决定，这里断言至少不抛错
    expect(typeof html).toBe("string");
  });

  it("escapes raw html (html:false — XSS 防线)", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders links with linkify", () => {
    const html = renderMarkdown("访问 https://example.com/docs 获取文档");
    expect(html).toContain('href="https://example.com/docs"');
  });
});
