// Unit tests for the Markdown -> OPML (mind map) exporter. Two contracts:
// `parseOutline` builds a hierarchy from headings (h1-h6) plus indented list
// items, and `markdownToOpml` serialises that tree into a document Xmind and
// other outliners can import. Everything must be XML-escaped.
import { describe, expect, it } from "vitest";

import { markdownToOpml, parseOutline } from "./opml";

describe("parseOutline - headings", () => {
  it("puts a single heading under the root", () => {
    expect(parseOutline("# 甲", "根")).toEqual({
      text: "根",
      children: [{ text: "甲", children: [] }],
    });
  });

  it("nests headings by level", () => {
    expect(parseOutline("# 甲\n## 乙\n### 丙\n## 丁", "根")).toEqual({
      text: "根",
      children: [
        {
          text: "甲",
          children: [
            { text: "乙", children: [{ text: "丙", children: [] }] },
            { text: "丁", children: [] },
          ],
        },
      ],
    });
  });

  it("treats a skipped level as a child of the deepest open heading", () => {
    expect(parseOutline("### 丙", "根")).toEqual({
      text: "根",
      children: [{ text: "丙", children: [] }],
    });
    expect(parseOutline("# 甲\n### 丙", "根")).toEqual({
      text: "根",
      children: [{ text: "甲", children: [{ text: "丙", children: [] }] }],
    });
  });

  it("supports heading levels up to h6", () => {
    expect(parseOutline("###### 六", "根").children).toEqual([{ text: "六", children: [] }]);
  });

  it("ignores a hash without a space (not a heading)", () => {
    expect(parseOutline("#不是标题", "根").children).toEqual([]);
  });

  it("trims heading text", () => {
    expect(parseOutline("#   甲   ", "根").children).toEqual([{ text: "甲", children: [] }]);
  });

  it("keeps sibling headings at the same level", () => {
    expect(parseOutline("# 甲\n# 乙", "根").children.map((n) => n.text)).toEqual(["甲", "乙"]);
  });

  it("returns an empty tree for an empty document", () => {
    expect(parseOutline("", "根")).toEqual({ text: "根", children: [] });
  });
});

describe("parseOutline - list items", () => {
  it("attaches top-level items to the current heading", () => {
    expect(parseOutline("## 列表\n- 甲\n- 乙", "根")).toEqual({
      text: "根",
      children: [
        {
          text: "列表",
          children: [
            { text: "甲", children: [] },
            { text: "乙", children: [] },
          ],
        },
      ],
    });
  });

  it("attaches items before any heading to the root", () => {
    expect(parseOutline("- 甲\n* 乙\n1. 丙", "根").children).toEqual([
      { text: "甲", children: [] },
      { text: "乙", children: [] },
      { text: "丙", children: [] },
    ]);
  });

  it("nests items two spaces per level", () => {
    expect(parseOutline("- 甲\n  - 甲一\n    - 甲一①", "根").children).toEqual([
      {
        text: "甲",
        children: [
          { text: "甲一", children: [{ text: "甲一①", children: [] }] },
        ],
      },
    ]);
  });

  it("folds an odd single-space indent back to top level", () => {
    // depth = floor(spaces / 2), so one space is depth 0
    expect(parseOutline("- 甲\n - 乙", "根").children).toEqual([
      { text: "甲", children: [] },
      { text: "乙", children: [] },
    ]);
  });

  it("pops back to the right parent when the indent decreases", () => {
    expect(parseOutline("- 甲\n    - 甲一\n  - 甲二", "根").children).toEqual([
      {
        text: "甲",
        children: [
          { text: "甲一", children: [] },
          { text: "甲二", children: [] },
        ],
      },
    ]);
  });

  it("treats a deep indent with no open items as top level", () => {
    expect(parseOutline("        - 甲", "根").children).toEqual([{ text: "甲", children: [] }]);
  });

  it("restarts list nesting after a new heading", () => {
    expect(parseOutline("# 标题\n## 一\n- a\n  - b\n## 二\n  - c", "根")).toEqual({
      text: "根",
      children: [
        {
          text: "标题",
          children: [
            { text: "一", children: [{ text: "a", children: [{ text: "b", children: [] }] }] },
            { text: "二", children: [{ text: "c", children: [] }] },
          ],
        },
      ],
    });
  });

  it("ignores paragraphs, quotes and rules", () => {
    expect(parseOutline("# 甲\n正文一行\n> 引用\n---\n- 乙", "根")).toEqual({
      text: "根",
      children: [
        {
          text: "甲",
          children: [{ text: "乙", children: [] }],
        },
      ],
    });
  });
});

describe("markdownToOpml", () => {
  it("serialises the tree into a complete OPML document", () => {
    const opml = markdownToOpml("# 甲\n## 乙", "我的主题");
    expect(opml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        "  <head>",
        "    <title>我的主题</title>",
        "  </head>",
        "  <body>",
        '    <outline text="甲">',
        '      <outline text="乙"/>',
        "    </outline>",
        "  </body>",
        "</opml>",
        "",
      ].join("\n"),
    );
  });

  it("emits an empty body for an empty report", () => {
    expect(markdownToOpml("", "空")).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        "  <head>",
        "    <title>空</title>",
        "  </head>",
        "  <body>",
        "",
        "  </body>",
        "</opml>",
        "",
      ].join("\n"),
    );
  });

  it("escapes XML-significant characters in titles and nodes", () => {
    const opml = markdownToOpml('# A & B <x> "q" \'s\'', `T & <U>`);
    expect(opml).toContain("<title>T &amp; &lt;U&gt;</title>");
    expect(opml).toContain('text="A &amp; B &lt;x&gt; &quot;q&quot; &apos;s&apos;"');
    expect(opml).not.toContain("<x>");
  });

  it("indents one level per depth and self-closes leaves", () => {
    const opml = markdownToOpml("- 甲\n  - 甲一", "根");
    expect(opml).toContain('    <outline text="甲">\n      <outline text="甲一"/>\n    </outline>');
  });

  it("is deterministic for the same input", () => {
    const md = "# 甲\n- 乙";
    expect(markdownToOpml(md, "根")).toBe(markdownToOpml(md, "根"));
  });
});
