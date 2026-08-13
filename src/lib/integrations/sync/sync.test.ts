// P7-2 unit tests: Notion blocks -> Markdown and Confluence HTML -> Markdown
// converters (pure functions, no network).
import { describe, it, expect } from "vitest";
import { blocksToMarkdown } from "./notion";
import { htmlToMarkdown } from "./confluence";

describe("blocksToMarkdown (Notion)", () => {
  it("converts headings / paragraphs / lists / todo / quote", () => {
    const md = blocksToMarkdown([
      { type: "heading_1", heading_1: { rich_text: [{ plain_text: "标题" }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "正文", annotations: { bold: true } }] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "项一" }] } },
      { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "项二" }] } },
      { type: "to_do", to_do: { rich_text: [{ plain_text: "任务" }], checked: true } },
      { type: "quote", quote: { rich_text: [{ plain_text: "引用" }] } },
      { type: "divider", divider: {} },
    ]);
    expect(md).toContain("# 标题");
    expect(md).toContain("**正文**");
    expect(md).toContain("- 项一");
    expect(md).toContain("1. 项二");
    expect(md).toContain("- [x] 任务");
    expect(md).toContain("> 引用");
    expect(md).toContain("---");
  });

  it("converts code blocks with language and inline formatting", () => {
    const md = blocksToMarkdown([
      { type: "code", code: { rich_text: [{ plain_text: "const a = 1" }], language: "typescript" } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "code", annotations: { code: true } }, { plain_text: " and " }, { plain_text: "link", href: "https://x.dev" }] } },
    ]);
    expect(md).toContain("```typescript\nconst a = 1\n```");
    expect(md).toContain("`code`");
    expect(md).toContain("[link](https://x.dev)");
  });

  it("renders tables from table_row children", () => {
    const md = blocksToMarkdown([
      {
        type: "table",
        table: {
          children: [
            { type: "table_row", table_row: { cells: [[{ plain_text: "A" }], [{ plain_text: "B" }]] } },
            { type: "table_row", table_row: { cells: [[{ plain_text: "1" }], [{ plain_text: "2" }]] } },
          ],
        },
      },
    ]);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("recurses nested children up to the depth cap and skips unknown types", () => {
    const md = blocksToMarkdown([
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "parent" }] }, has_children: true, children: [] as never[] },
      { type: "toggle", toggle: { rich_text: [{ plain_text: "折叠" }] }, children: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "内层" }] } }] as never[] },
      { type: "unsupported_future_block", unsupported_future_block: {} },
    ]);
    expect(md).toContain("> 折叠");
    expect(md).toContain("内层");
    expect(md).not.toContain("unsupported_future_block");
  });

  it("escapes pipes in table cells", () => {
    const md = blocksToMarkdown([
      { type: "table", table: { children: [{ type: "table_row", table_row: { cells: [[{ plain_text: "a|b" }]] } }] } },
    ]);
    expect(md).toContain("a\\|b");
  });
});

describe("htmlToMarkdown (Confluence)", () => {
  it("converts headings / lists / emphasis / links / code", () => {
    const md = htmlToMarkdown(
      "<h2>章节</h2><p>一段 <strong>加粗</strong> 和 <em>斜体</em>，<a href=\"https://d.dev\">链接</a></p>" +
      "<ul><li>甲</li><li>乙</li></ul><pre><code>const x = 1</code></pre>"
    );
    expect(md).toContain("## 章节");
    expect(md).toContain("**加粗**");
    expect(md).toContain("*斜体*");
    expect(md).toContain("[链接](https://d.dev)");
    expect(md).toContain("- 甲");
    expect(md).toContain("- 乙");
  });

  it("converts tables to pipe rows", () => {
    const md = htmlToMarkdown("<table><tr><th>列1</th><th>列2</th></tr><tr><td>值1</td><td>值2</td></tr></table>");
    expect(md).toContain("| 列1 | 列2 |");
    expect(md).toContain("| 值1 | 值2 |");
  });

  it("unwraps ac:structured-macro keeping the rich-text body", () => {
    const md = htmlToMarkdown(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>宏内容</p></ac:rich-text-body></ac:structured-macro>'
    );
    expect(md).toContain("宏内容");
    expect(md).not.toContain("ac:structured-macro");
  });

  it("decodes entities and normalizes whitespace", () => {
    const md = htmlToMarkdown("<p>a&nbsp;&amp;&nbsp;b</p><p>  c  </p>");
    expect(md).toContain("a & b");
    expect(md).toContain("c");
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("handles empty / macro-only content gracefully", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("<ac:structured-macro ac:name=\"code\"><ac:parameter ac:name=\"lang\">js</ac:parameter></ac:structured-macro>")).toBe("");
  });
});
