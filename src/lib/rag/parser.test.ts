// P6-3 unit tests: rag/parser (text/markdown/csv/html + pdf/docx/xlsx mocks).
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDocument } from "./parser";

// Mock pdfjs-dist text extraction (same module specifier the parser imports).
const { mockPdfGetTextContent, mockPdfGetMetadata } = vi.hoisted(() => ({
  mockPdfGetTextContent: vi.fn(async () => ({
    items: [
      { str: "PDF 解析出的正文内容，超过二十个字符，用于验证非扫描版 PDF 的文本提取路径是否正常工作。", hasEOL: true },
    ],
  })),
  mockPdfGetMetadata: vi.fn(async () => ({ info: { Title: "PDF 标题" } })),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ getTextContent: mockPdfGetTextContent }),
      getMetadata: mockPdfGetMetadata,
    }),
  }),
}));

vi.mock("mammoth", () => ({
  convertToHtml: async () => ({
    value: "<h1>Word 文档</h1><p>这是从 docx 提取的正文段落内容。</p>",
  }),
}));

vi.mock("xlsx", () => ({
  read: () => ({
    SheetNames: ["Sheet1"],
    Sheets: { Sheet1: {} },
  }),
  utils: { sheet_to_csv: () => "姓名,部门\n张三,研发" },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("OCR_ENABLED", "false");
});

describe("parseDocument", () => {
  it("parses plain text with a title from the first line", async () => {
    const out = await parseDocument(Buffer.from("我的文档标题\n\n这里是正文内容。"), "note.txt", "text");
    expect(out).not.toBeNull();
    expect(out!.text).toContain("这里是正文内容");
  });

  it("parses markdown", async () => {
    const out = await parseDocument(Buffer.from("# 标题\n\n正文段落内容。"), "doc.md", "markdown");
    expect(out!.text).toContain("标题");
  });

  it("parses csv as text", async () => {
    const out = await parseDocument(Buffer.from("a,b,c\n1,2,3\n"), "data.csv", "csv");
    expect(out!.text).toContain("a,b,c");
  });

  it("parses html and strips tags, extracting the title", async () => {
    const html = "<html><head><title>网页标题</title></head><body><p>这是一段足够长的正文内容，用来测试 HTML 解析是否能够正确剥离标签并保留全部文本信息，同时提取出页面标题。</p></body></html>";
    const out = await parseDocument(Buffer.from(html), "page.html", "web");
    expect(out).not.toBeNull();
    expect(out!.title).toBe("网页标题");
    expect(out!.text).not.toContain("<p>");
    expect(out!.text).toContain("正文内容");
  });

  it("returns null for empty html body", async () => {
    const out = await parseDocument(Buffer.from("<html><body></body></html>"), "empty.html", "web");
    expect(out).toBeNull();
  });

  it("routes unknown types by extension", async () => {
    const out = await parseDocument(Buffer.from("扩展名解析正文"), "data.md", "other");
    expect(out!.text).toContain("扩展名解析正文");
  });

  it("returns null for unsupported .doc legacy files", async () => {
    const out = await parseDocument(Buffer.from("legacy"), "old.doc", "word");
    expect(out).toBeNull();
  });
});

describe("parseDocument with heavy deps mocked", () => {
  it("parses pdf text (non-scanned)", async () => {
    const out = await parseDocument(Buffer.from("%PDF-fake"), "paper.pdf", "pdf");
    expect(out).not.toBeNull();
    expect(out!.text).toContain("PDF 解析出的正文内容");
    expect(out!.title).toBe("PDF 标题");
  });

  it("returns null when pdf has no extractable text (OCR disabled)", async () => {
    mockPdfGetTextContent.mockResolvedValueOnce({
      items: [{ str: "x", hasEOL: false }],
    });
    const out = await parseDocument(Buffer.from("%PDF-fake"), "scan.pdf", "pdf");
    expect(out).toBeNull();
  });

  it("parses docx via mammoth", async () => {
    const out = await parseDocument(Buffer.from("docx-bytes"), "doc.docx", "word");
    expect(out).not.toBeNull();
    expect(out!.text).toContain("Word 文档");
  });

  it("parses xlsx via sheet_to_csv", async () => {
    const out = await parseDocument(Buffer.from("xlsx-bytes"), "data.xlsx", "other");
    expect(out).not.toBeNull();
    expect(out!.text).toContain("张三");
  });
});
