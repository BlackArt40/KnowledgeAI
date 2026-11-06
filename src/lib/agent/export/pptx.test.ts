// Unit tests for the zero-dependency PPTX generator. The output is an OOXML
// package, so the tests unpack it with an independent zlib-based reader and
// assert on (a) the required parts existing, (b) slide sequencing rules
// (`#` cover / `##` content / `###` + list + paragraph -> bullets), and
// (c) XML escaping of user-authored text.
import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { AgentTask } from "../types";
import { generatePptx } from "./pptx";

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task_1",
    topic: "年度调研",
    workspaceId: "ws_default",
    outputFormat: "ppt",
    agents: ["planner", "searcher", "analyzer", "writer"],
    maxSteps: 8,
    status: "done",
    steps: [],
    report: "",
    citations: [],
    outline: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
    ...overrides,
  };
}

/** Unpack a STORE/DEFLATE archive into `path -> utf-8 text`. */
function unzipText(bytes: Uint8Array): Map<string, string> {
  const buf = Buffer.from(bytes);
  const eocdOffset = buf.length - 22;
  const total = buf.readUInt16LE(eocdOffset + 10);
  let p = buf.readUInt32LE(eocdOffset + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < total; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf-8", p + 46, p + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf-8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "ppt/presentation.xml",
  "ppt/_rels/presentation.xml.rels",
  "ppt/theme/theme1.xml",
  "ppt/slideMasters/slideMaster1.xml",
  "ppt/slideMasters/_rels/slideMaster1.xml.rels",
  "ppt/slideLayouts/slideLayout1.xml",
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
];

/** Slide XML parts in presentation order. */
function slideParts(parts: Map<string, string>): string[] {
  return [...parts.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const n = (s: string) => Number(/(\d+)\.xml$/.exec(s)![1]);
      return n(a) - n(b);
    })
    .map((k) => parts.get(k)!);
}

/** Titles read from the title placeholder of each slide. */
function titles(slides: string[]): string[] {
  return slides.map((xml) => {
    const m = /<p:ph type="title"\/>[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/.exec(xml);
    return m ? m[1] : "";
  });
}

/** Bullet texts (body placeholder runs) of a single slide. */
function bullets(xml: string): string[] {
  const body = /<p:ph type="body" idx="1"\/>[\s\S]*<\/p:txBody>/.exec(xml);
  if (!body) return [];
  return [...body[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
}

function build(overrides: Partial<AgentTask> = {}) {
  return unzipText(generatePptx(makeTask(overrides)));
}

describe("generatePptx - package structure", () => {
  it("returns a ZIP whose first record is a local file header", () => {
    const bytes = generatePptx(makeTask({ report: "# 封面" }));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes.subarray(0, 4)).readUInt32LE(0)).toBe(0x04034b50);
  });

  it("contains every required OOXML part plus one slide part per slide", () => {
    const parts = build({ report: "# 封面\n## 一\n## 二" });
    for (const name of REQUIRED_PARTS) expect(parts.has(name)).toBe(true);
    expect(parts.size).toBe(REQUIRED_PARTS.length + 3 * 2); // slide xml + slide rels
    for (let i = 1; i <= 3; i++) {
      expect(parts.has(`ppt/slides/slide${i}.xml`)).toBe(true);
      expect(parts.has(`ppt/slides/_rels/slide${i}.xml.rels`)).toBe(true);
    }
  });

  it("declares an XML declaration on every package part", () => {
    for (const [name, text] of build({ report: "# 封面" })) {
      expect(text.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
      expect(name).toBeTruthy();
    }
  });

  it("declares content types and ids for every slide", () => {
    const parts = build({ report: "# 封面\n## 一\n## 二" });
    const types = parts.get("[Content_Types].xml")!;
    expect([...types.matchAll(/PartName="\/ppt\/slides\/slide\d+\.xml"/g)]).toHaveLength(3);
    expect(types).toContain("presentationml.presentation.main+xml");

    const presentation = parts.get("ppt/presentation.xml")!;
    expect([...presentation.matchAll(/<p:sldId id="(\d+)" r:id="rId\d+"\/>/g)].map((m) => m[1])).toEqual([
      "256",
      "257",
      "258",
    ]);

    const rels = parts.get("ppt/_rels/presentation.xml.rels")!;
    expect([...rels.matchAll(/Target="slides\/slide\d+\.xml"/g)]).toHaveLength(3);
    expect(rels).toContain('Id="rId1"');
  });

  it("is byte-for-byte deterministic (no timestamps leak into the archive)", () => {
    const a = generatePptx(makeTask({ report: "# 封面\n## 一" }));
    const b = generatePptx(makeTask({ report: "# 封面\n## 一" }));
    expect([...a]).toEqual([...b]);
  });
});

describe("generatePptx - slide sequencing", () => {
  it("uses the `#` heading as the cover title", () => {
    const slides = slideParts(build({ report: "# 封面标题\n## 正文页" }));
    expect(titles(slides)).toEqual(["封面标题", "正文页"]);
    expect(slides[0]).toContain('sz="4000"'); // cover title size
    expect(slides[1]).toContain('sz="2800"'); // content title size
  });

  it("falls back to the task topic when the cover heading is empty", () => {
    const slides = slideParts(build({ topic: "年度调研", report: "# \n## 一" }));
    expect(titles(slides)[0]).toBe("年度调研");
  });

  it("prepends a cover slide when the report has no `#` heading", () => {
    const slides = slideParts(build({ topic: "年度调研", report: "## 一\n- 甲" }));
    expect(titles(slides)).toEqual(["年度调研", "一"]);
    expect(bullets(slides[0])).toEqual(["数据来源：公开检索"]);
  });

  it("names the knowledge base on the injected cover when available", () => {
    const slides = slideParts(build({ kbName: "产品文档库", report: "## 一" }));
    expect(bullets(slides[0])).toEqual(["数据来源：产品文档库"]);
  });

  it("keeps multiple `#` headings as separate cover slides and does not prepend another", () => {
    const slides = slideParts(build({ report: "# 甲\n## 中间\n# 乙" }));
    expect(titles(slides)).toEqual(["甲", "中间", "乙"]);
    expect(bullets(slides[0])).toEqual([]);
  });

  it("produces a cover plus a placeholder slide for an empty report", () => {
    const slides = slideParts(build({ report: "" }));
    expect(titles(slides)).toEqual(["年度调研", "年度调研"]);
    expect(bullets(slides[0])).toEqual(["数据来源：公开检索"]);
    expect(bullets(slides[1])).toEqual(["（无内容）"]);
  });

  it("emits an end-paragraph run for a slide without bullets", () => {
    const [cover] = slideParts(build({ report: "# 封面" }));
    expect(cover).toContain('<a:endParaRPr lang="zh-CN"/>');
  });

  it("treats a missing report like an empty one", () => {
    const slides = slideParts(build({ report: undefined }));
    expect(slides).toHaveLength(2);
    expect(bullets(slides[1])).toEqual(["（无内容）"]);
  });

  it("drops paragraph text that appears before any heading", () => {
    const slides = slideParts(build({ report: "前言段落\n## 要点\n- 甲" }));
    expect(titles(slides)).toEqual(["年度调研", "要点"]);
    expect(slides.join("")).not.toContain("前言段落");
  });
});

describe("generatePptx - bullet extraction", () => {
  it("turns `###` headings and list items into bullets of the current `##` slide", () => {
    const slides = slideParts(
      build({ report: "## 要点\n### 子标题\n- 第一条\n1. 第二条\n* 第三条" }),
    );
    expect(bullets(slides[1])).toEqual(["子标题", "第一条", "第二条", "第三条"]);
  });

  it("treats plain paragraph lines as bullets but drops quotes and rules", () => {
    const slides = slideParts(build({ report: "## 要点\n正文一行\n> 引用\n---\n正文二行" }));
    expect(bullets(slides[1])).toEqual(["正文一行", "正文二行"]);
    expect(slides[1]).not.toContain("引用");
  });

  it("starts a slide from a `##` heading with no bullets yet", () => {
    const slides = slideParts(build({ report: "# 封面\n## 空页\n## 有内容\n- 甲" }));
    expect(titles(slides)).toEqual(["封面", "空页", "有内容"]);
    expect(bullets(slides[2])).toEqual(["甲"]);
  });

  it("uses the `###` text as a slide title when it appears before any `##`", () => {
    const slides = slideParts(build({ topic: "年度调研", report: "### 孤立小节" }));
    expect(titles(slides)).toEqual(["年度调研", "孤立小节"]);
  });

  it("puts bullets before any heading on a topic-titled slide", () => {
    const slides = slideParts(build({ topic: "年度调研", report: "- 甲\n- 乙" }));
    expect(titles(slides)[1]).toBe("年度调研");
    expect(bullets(slides[1])).toEqual(["甲", "乙"]);
  });

  it("trims surrounding whitespace of bullet text", () => {
    const slides = slideParts(build({ report: "## 要点\n-   空格  " }));
    expect(bullets(slides[1])).toEqual(["空格"]);
  });
});

describe("generatePptx - escaping", () => {
  it("escapes XML-significant characters in titles", () => {
    const slides = slideParts(build({ report: '# A & B <C> "D"' }));
    expect(titles(slides)[0]).toBe("A &amp; B &lt;C&gt; &quot;D&quot;");
    expect(slides[0]).not.toContain("<C>");
  });

  it("escapes XML-significant characters in bullets", () => {
    const slides = slideParts(build({ report: "## 要点\n- a < b & c" }));
    expect(bullets(slides[1])).toEqual(["a &lt; b &amp; c"]);
  });

  it("keeps CJK text intact through UTF-8 encoding", () => {
    const slides = slideParts(build({ report: "# 中文封面\n## 中文小节\n- 中文条目" }));
    expect(titles(slides)).toEqual(["中文封面", "中文小节"]);
    expect(bullets(slides[1])).toEqual(["中文条目"]);
  });
});
