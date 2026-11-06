// Unit tests for the server-side Markdown -> HTML renderer used by the PDF
// print document. The renderer is a hand-rolled subset of Markdown, so the
// contract worth pinning down is: (1) every text node is HTML-escaped before
// any inline rule runs (no XSS through report content), (2) the block grammar
// (headings 1-3 / hr / blockquote / nested lists / paragraphs) maps to the
// documented tags, and (3) unsupported syntax degrades to literal text instead
// of throwing.
import { describe, expect, it } from "vitest";

import { escapeHtml, renderMarkdownToHtml } from "./markdown-html";

describe("escapeHtml", () => {
  it("escapes the four HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("leaves plain text and CJK untouched", () => {
    expect(escapeHtml("报告 2026 · 甲")).toBe("报告 2026 · 甲");
  });

  it("returns an empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("renderMarkdownToHtml - inline rules", () => {
  it("renders bold, inline code and citation markers", () => {
    expect(renderMarkdownToHtml("这是 **重点** 和 `code` 以及 [3]。")).toBe(
      `<p>这是 <strong>重点</strong> 和 <code>code</code> 以及 <sup class="cite"><a href="#cite-3">[3]</a></sup>。</p>`,
    );
  });

  it("links every citation marker in a line", () => {
    const html = renderMarkdownToHtml("结论 [1] 得到 [12] 支持");
    expect(html).toContain('href="#cite-1"');
    expect(html).toContain('href="#cite-12"');
    expect(html.match(/<sup class="cite">/g)).toHaveLength(2);
  });

  it("does not treat non-numeric brackets as citations", () => {
    expect(renderMarkdownToHtml("见 [注] 与 [abc]")).toBe("<p>见 [注] 与 [abc]</p>");
  });

  it("does not support single-asterisk emphasis (stays literal)", () => {
    expect(renderMarkdownToHtml("这是 *斜体*")).toBe("<p>这是 *斜体*</p>");
  });

  it("escapes HTML inside inline code instead of emitting markup", () => {
    expect(renderMarkdownToHtml("用 `<img src=x onerror=alert(1)>`")).toBe(
      "<p>用 <code>&lt;img src=x onerror=alert(1)&gt;</code></p>",
    );
  });

  it("escapes raw HTML in plain text", () => {
    expect(renderMarkdownToHtml(`<script>alert("x")</script>`)).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });
});

describe("renderMarkdownToHtml - block rules", () => {
  it("renders headings level 1-3", () => {
    expect(renderMarkdownToHtml("# 一级\n## 二级\n### 三级")).toBe(
      "<h1>一级</h1>\n<h2>二级</h2>\n<h3>三级</h3>",
    );
  });

  it("falls back to a paragraph for level 4+ headings", () => {
    expect(renderMarkdownToHtml("#### 四级")).toBe("<p>#### 四级</p>");
  });

  it("renders a thematic break", () => {
    expect(renderMarkdownToHtml("上\n\n---\n\n下")).toBe("<p>上</p>\n<hr/>\n<p>下</p>");
  });

  it("renders blockquotes with inline formatting", () => {
    expect(renderMarkdownToHtml("> **注意** 这里")).toBe(
      "<blockquote><strong>注意</strong> 这里</blockquote>",
    );
  });

  it("joins consecutive lines into one space-separated paragraph", () => {
    expect(renderMarkdownToHtml("第一行\n第二行\n第三行")).toBe("<p>第一行 第二行 第三行</p>");
  });

  it("splits a paragraph when the next line starts a block", () => {
    expect(renderMarkdownToHtml("正文\n## 小节")).toBe("<p>正文</p>\n<h2>小节</h2>");
  });

  it("skips blank lines without emitting empty paragraphs", () => {
    expect(renderMarkdownToHtml("\n\n甲\n\n\n乙\n\n")).toBe("<p>甲</p>\n<p>乙</p>");
  });

  it("returns an empty fragment for an empty or whitespace-only document", () => {
    expect(renderMarkdownToHtml("")).toBe("");
    expect(renderMarkdownToHtml("  \n\t\n ")).toBe("");
  });
});

describe("renderMarkdownToHtml - lists", () => {
  it("renders unordered and ordered items as a ul", () => {
    expect(renderMarkdownToHtml("- 甲\n- 乙")).toBe("<ul><li>甲</li><li>乙</li></ul>");
    expect(renderMarkdownToHtml("1. 甲\n2. 乙")).toBe("<ul><li>甲</li><li>乙</li></ul>");
  });

  it("strips the bullet marker and keeps inline formatting", () => {
    expect(renderMarkdownToHtml("- **甲** [2]")).toBe(
      `<ul><li><strong>甲</strong> <sup class="cite"><a href="#cite-2">[2]</a></sup></li></ul>`,
    );
  });

  it("nests by indentation", () => {
    expect(renderMarkdownToHtml("- 甲\n  - 甲一\n  - 甲二\n- 乙")).toBe(
      "<ul><li>甲<ul><li>甲一</li><li>甲二</li></ul></li><li>乙</li></ul>",
    );
  });

  it("keeps a list going across a single blank line", () => {
    expect(renderMarkdownToHtml("- 甲\n\n- 乙")).toBe("<ul><li>甲</li><li>乙</li></ul>");
  });

  it("ends the list at a blank line followed by a paragraph", () => {
    expect(renderMarkdownToHtml("- 甲\n\n正文")).toBe("<ul><li>甲</li></ul>\n<p>正文</p>");
  });

  it("keeps the bare marker for a bullet without text", () => {
    // the marker stripper needs `marker + whitespace + text`, so a lone "- "
    // keeps its dash after trimming
    expect(renderMarkdownToHtml("- ")).toBe("<ul><li>-</li></ul>");
  });

  it("escapes HTML inside list items", () => {
    expect(renderMarkdownToHtml(`- <b>x</b>`)).toBe("<ul><li>&lt;b&gt;x&lt;/b&gt;</li></ul>");
  });
});

describe("renderMarkdownToHtml - document composition", () => {
  it("renders a realistic report skeleton in order", () => {
    const md = [
      "# 调研报告",
      "",
      "## 结论",
      "",
      "总体 **可行**，见 [1]。",
      "",
      "- 成本可控",
      "- 风险中等",
      "",
      "---",
      "",
      "> 数据来源：公开检索",
    ].join("\n");

    expect(renderMarkdownToHtml(md)).toBe(
      [
        "<h1>调研报告</h1>",
        "<h2>结论</h2>",
        "<p>总体 <strong>可行</strong>，见 <sup class=\"cite\"><a href=\"#cite-1\">[1]</a></sup>。</p>",
        "<ul><li>成本可控</li><li>风险中等</li></ul>",
        "<hr/>",
        "<blockquote>数据来源：公开检索</blockquote>",
      ].join("\n"),
    );
  });

  it("is deterministic for the same input", () => {
    const md = "# 甲\n- 一\n- 二";
    expect(renderMarkdownToHtml(md)).toBe(renderMarkdownToHtml(md));
  });
});
