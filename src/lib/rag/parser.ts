// ---------------------------------------------------------------------------
// Document Parser - multi-format text extraction for knowledge base indexing.
//
// Supported formats:
//   .txt / .md / .csv / .json  -> direct UTF-8 read
//   .html / .htm               -> strip tags (reuse fetcher logic)
//   .pdf                       -> pdf-parse (dynamic import)
//   .docx                      -> mammoth (dynamic import)
//   .xlsx / .xls               -> xlsx / SheetJS (dynamic import)
//   .pptx                      -> zip XML extraction (built-in)
//
// Optional packages are dynamically imported with graceful fallback.
// When a parser is not installed, returns null and the document is marked
// as "failed" with a helpful error message.
// ---------------------------------------------------------------------------

import zlib from "zlib";
import type { DocType } from "@/lib/kb/types";

export interface ParsedDocument {
  text: string;
  title: string | null;
  pages?: number;       // for PDF/PPT
  sheets?: string[];    // for Excel sheet names
}

/** Parse a document buffer into text. Returns null on failure. */
export async function parseDocument(
  buf: Buffer,
  filename: string,
  type: DocType
): Promise<ParsedDocument | null> {
  switch (type) {
    case "text":
    case "markdown":
    case "csv":
      return parseText(buf);
    case "web":
      return parseHtml(buf);
    case "pdf":
      return parsePdf(buf);
    case "word":
      return parseWord(buf, filename);
    case "other":
      // Try by extension
      return parseByExtension(buf, filename);
    default:
      return parseByExtension(buf, filename);
  }
}

// ── Text / Markdown / CSV ────────────────────────────────────────────────

function parseText(buf: Buffer): ParsedDocument {
  const text = buf.toString("utf-8");
  return { text, title: extractTitle(text) };
}

function extractTitle(text: string): string | null {
  const m = text.match(/^#\s+(.+)/m);
  return m ? m[1].trim().slice(0, 120) : null;
}

// ── HTML ────────────────────────────────────────────────────────────────

function parseHtml(buf: Buffer): ParsedDocument | null {
  const html = buf.toString("utf-8");
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/<[^>]+>/g, " ");
  body = body
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (body.length < 40) return null;
  return { text: body.slice(0, 500_000), title };
}

// ── PDF (pdf-parse) ─────────────────────────────────────────────────────

async function parsePdf(buf: Buffer): Promise<ParsedDocument | null> {
  try {
    const mod = await import("pdf-parse");
    const pdfParse = (mod as { default?: (buf: Buffer) => Promise<{ text: string; numpages?: number; info?: { Title?: string } }> }).default
      || (mod as unknown as (buf: Buffer) => Promise<{ text: string; numpages?: number; info?: { Title?: string } }>);
    const data = await pdfParse(buf);
    const text = data.text?.trim();
    if (!text || text.length < 10) return null;
    return {
      text: text.slice(0, 500_000),
      title: data.info?.Title?.trim() || null,
      pages: data.numpages,
    };
  } catch {
    console.warn("[parser] pdf-parse not installed - PDF parsing unavailable");
    return null;
  }
}

// ── Word .docx (mammoth) ────────────────────────────────────────────────

async function parseWord(buf: Buffer, filename: string): Promise<ParsedDocument | null> {
  // .docx -> mammoth.extractRawText
  if (filename.toLowerCase().endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const result = await (mammoth as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> })
        .extractRawText({ buffer: buf });
      const text = result.value?.trim();
      if (!text || text.length < 10) return null;
      return { text: text.slice(0, 500_000), title: null };
    } catch {
      console.warn("[parser] mammoth not installed - .docx parsing unavailable");
      return null;
    }
  }
  // .doc (legacy binary) - not supported without antiword/textract
  console.warn("[parser] .doc (legacy) not supported - convert to .docx");
  return null;
}

// ── Excel .xlsx (xlsx / SheetJS) ────────────────────────────────────────

async function parseExcel(buf: Buffer): Promise<ParsedDocument | null> {
  try {
    const XLSX = await import("xlsx");
    const workbook = (XLSX as { read: (buf: Buffer, opts: unknown) => { SheetNames: string[]; Sheets: Record<string, unknown> } })
      .read(buf, { type: "buffer" });
    const sheets: string[] = [];
    let text = "";
    for (const sheetName of workbook.SheetNames) {
      sheets.push(sheetName);
      const sheet = workbook.Sheets[sheetName];
      const csv = (XLSX as { utils: { sheet_to_csv: (sheet: unknown) => string } })
        .utils.sheet_to_csv(sheet);
      text += `\n## ${sheetName}\n${csv}\n`;
    }
    text = text.trim();
    if (text.length < 10) return null;
    return { text: text.slice(0, 500_000), title: null, sheets };
  } catch {
    console.warn("[parser] xlsx not installed - Excel parsing unavailable");
    return null;
  }
}

// ── PPT .pptx (built-in ZIP/XML extraction) ─────────────────────────────

async function parsePptx(buf: Buffer): Promise<ParsedDocument | null> {
  try {
    // .pptx is a ZIP; slide text is in ppt/slides/slideN.xml
    // We do a lightweight extraction without a full ZIP library by searching
    // for <a:t> text runs in the binary data.
    const text = extractPptxText(buf);
    if (!text || text.length < 10) return null;
    return { text: text.slice(0, 500_000), title: null };
  } catch {
    console.warn("[parser] PPTX extraction failed");
    return null;
  }
}

/** Extract text from PPTX by finding <a:t> elements in the ZIP binary. */
function extractPptxText(buf: Buffer): string {
  // PPTX uses ZIP compression; we need to decompress.
  // Look for slide XML entries and extract <a:t> text.
  // This is a best-effort approach using regex on decompressed data.
  const str = buf.toString("latin1");

  // Find local file headers for slide XMLs (PK\x03\x04)
  const texts: string[] = [];
  const slidePattern = /ppt\/slides\/slide\d+\.xml/g;
  let match: RegExpExecArray | null;
  const positions: number[] = [];
  while ((match = slidePattern.exec(str)) !== null) {
    positions.push(match.index);
  }

  if (positions.length === 0) return "";

  for (const pos of positions) {
    // Find the compressed data after the local file header
    // Local header: PK\x03\x04 + 26 bytes + name length + extra length
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const compStart = pos + 30 + nameLen + extraLen;
    const compMethod = buf.readUInt16LE(pos + 8);

    try {
      let xml: string;
      if (compMethod === 8) {
        // Deflate
        const compData = buf.subarray(compStart);
        const decompressed = zlib.inflateSync(compData);
        xml = decompressed.toString("utf-8");
      } else {
        // Stored (no compression)
        const compSize = buf.readUInt32LE(pos + 18);
        xml = buf.subarray(compStart, compStart + compSize).toString("utf-8");
      }
      // Extract <a:t> text runs
      const tRuns = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
      const slideText = tRuns
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join(" ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      if (slideText) texts.push(slideText);
    } catch {
      // skip unreadable slide
    }
  }
  return texts.join("\n\n");
}

// ── Fallback: parse by extension ─────────────────────────────────────────

async function parseByExtension(buf: Buffer, filename: string): Promise<ParsedDocument | null> {
  const ext = filename.toLowerCase();
  if (ext.endsWith(".pdf")) return parsePdf(buf);
  if (ext.endsWith(".docx")) return parseWord(buf, filename);
  if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) return parseExcel(buf);
  if (ext.endsWith(".pptx")) return parsePptx(buf);
  if (ext.endsWith(".html") || ext.endsWith(".htm")) return parseHtml(buf);
  if (ext.endsWith(".json")) return parseText(buf);
  // Try as plain text
  return parseText(buf);
}
