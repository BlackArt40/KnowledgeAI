// Unit tests for the self-contained print document behind the PDF export.
// The document is what the user actually prints, so the tests pin down the
// header metadata (source / date / duration), the citation list (anchors that
// the `[n]` markers in the body link to), and the escaping of untrusted
// report content into the page title and body.
import { describe, expect, it } from "vitest";

import type { AgentCitation, AgentTask } from "../types";
import { renderPrintHtml } from "./pdf-print";

const CREATED_AT = 1_700_000_000_000;

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task_1",
    topic: "年度调研",
    workspaceId: "ws_default",
    outputFormat: "report",
    agents: ["planner", "writer"],
    maxSteps: 4,
    status: "done",
    steps: [],
    report: "",
    citations: [],
    outline: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function citation(overrides: Partial<AgentCitation> = {}): AgentCitation {
  return {
    n: 1,
    title: "来源标题",
    source: "公开检索",
    snippet: "摘要",
    score: 0.9,
    ...overrides,
  };
}

describe("renderPrintHtml - document shell", () => {
  it("emits a complete self-contained HTML document", () => {
    const html = renderPrintHtml(makeTask());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<meta charset="utf-8"/>');
    expect(html).toContain("</style>");
  });

  it("ships the print toolbar and the print stylesheet", () => {
    const html = renderPrintHtml(makeTask());
    expect(html).toContain('class="toolbar"');
    expect(html).toContain("window.print()");
    expect(html).toContain("@media print");
    expect(html).toContain(".toolbar { display: none; }");
  });

  it("escapes the topic in both the page title and the heading", () => {
    const html = renderPrintHtml(makeTask({ topic: `A & B <C> "D"` }));
    expect(html).toContain("<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>");
    expect(html).toContain("<h1>A &amp; B &lt;C&gt; &quot;D&quot;</h1>");
    expect(html).not.toContain("<C>");
  });
});

describe("renderPrintHtml - header metadata", () => {
  it("shows the knowledge base name as the data source", () => {
    expect(renderPrintHtml(makeTask({ kbName: "产品文档库" }))).toContain("数据来源：产品文档库");
  });

  it("falls back to 公开检索 when no knowledge base is attached", () => {
    const html = renderPrintHtml(makeTask({ kbName: undefined }));
    expect(html).toContain("数据来源：公开检索");
  });

  it("renders the creation date in the zh-CN locale", () => {
    const expected = new Date(CREATED_AT).toLocaleString("zh-CN", { hour12: false });
    expect(renderPrintHtml(makeTask())).toContain(expected);
  });

  it("formats the duration to one decimal place", () => {
    expect(renderPrintHtml(makeTask({ durationMs: 1_234 }))).toContain("耗时 1.2s");
    expect(renderPrintHtml(makeTask({ durationMs: 60_000 }))).toContain("耗时 60.0s");
  });

  it("omits the duration line when unknown or zero", () => {
    expect(renderPrintHtml(makeTask({ durationMs: undefined }))).not.toContain("耗时");
    expect(renderPrintHtml(makeTask({ durationMs: 0 }))).not.toContain("耗时");
  });
});

describe("renderPrintHtml - report body", () => {
  it("renders the markdown report inside the article element", () => {
    const html = renderPrintHtml(makeTask({ report: "# 结论\n\n- 甲\n- 乙" }));
    expect(html).toContain('<article class="report">');
    expect(html).toContain("<h1>结论</h1>");
    expect(html).toContain("<ul><li>甲</li><li>乙</li></ul>");
  });

  it("leaves the article empty when the report is missing", () => {
    const html = renderPrintHtml(makeTask({ report: undefined }));
    expect(html).toMatch(/<article class="report">\s*<\/article>/);
  });

  it("escapes raw HTML coming from the report", () => {
    const html = renderPrintHtml(makeTask({ report: "<script>alert(1)</script>" }));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("links body citation markers to the citation list anchors", () => {
    const html = renderPrintHtml(
      makeTask({ report: "结论 [1]", citations: [citation({ n: 1 })] }),
    );
    expect(html).toContain('<sup class="cite"><a href="#cite-1">[1]</a></sup>');
    expect(html).toContain('id="cite-1"');
  });
});

describe("renderPrintHtml - citations", () => {
  it("omits the citation section when there are no citations", () => {
    const html = renderPrintHtml(makeTask({ citations: [] }));
    expect(html).not.toContain('<section class="citations">');
    expect(html).not.toContain("引用来源");
  });

  it("tolerates a record without a citations array (legacy task rows)", () => {
    const task = makeTask({ citations: undefined as unknown as AgentCitation[] });
    const html = renderPrintHtml(task);
    expect(html).not.toContain('<section class="citations">');
    expect(html).toContain('<article class="report">');
  });

  it("numbers each citation with its own anchor id", () => {
    const html = renderPrintHtml(
      makeTask({ citations: [citation({ n: 1 }), citation({ n: 7, title: "第二来源" })] }),
    );
    expect(html).toContain('<section class="citations"><h2>引用来源</h2><ol>');
    expect(html).toContain('id="cite-1"');
    expect(html).toContain('id="cite-7"');
    expect(html).toContain('<span class="cite-no">[7]</span>');
  });

  it("turns an http(s) source into a safe external link", () => {
    const html = renderPrintHtml(
      makeTask({ citations: [citation({ source: "官方文档 https://example.com/a?b=1" })] }),
    );
    expect(html).toContain(
      '<a href="https://example.com/a?b=1" target="_blank" rel="noopener">官方文档 https://example.com/a?b=1</a>',
    );
  });

  it("keeps a non-URL source as plain escaped text", () => {
    const html = renderPrintHtml(makeTask({ citations: [citation({ source: "内部 <知识库>" })] }));
    expect(html).toContain("内部 &lt;知识库&gt;");
    expect(html).not.toContain('href="内部');
  });

  it("escapes the citation title and snippet", () => {
    const html = renderPrintHtml(
      makeTask({ citations: [citation({ title: "<b>粗</b>", snippet: `a & "b"` })] }),
    );
    expect(html).toContain("&lt;b&gt;粗&lt;/b&gt;");
    expect(html).toContain("a &amp; &quot;b&quot;");
  });
});

describe("renderPrintHtml - determinism", () => {
  it("returns identical markup for identical tasks", () => {
    const task = makeTask({ report: "# 甲\n- 乙", citations: [citation()] });
    expect(renderPrintHtml(task)).toBe(renderPrintHtml(task));
  });
});
