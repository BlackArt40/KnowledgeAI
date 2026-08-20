// ---------------------------------------------------------------------------
// Document Parser - multi-format text extraction for knowledge base indexing.
//
// Supported formats:
//   .txt / .md / .csv / .json  -> direct UTF-8 read
//   .html / .htm               -> strip tags (reuse fetcher logic)
//   .pdf                       -> pdfjs-dist text extraction (dynamic import)
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
import { isScannedPdf, ocrScannedPdf } from "./ocr";
import { describeImage } from "./vision";
import { log } from "@/lib/obs/log";

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
    case "image":
      return parseImage(buf);
    case "subtitle":
      return parseSubtitle(buf);
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

// ── Shared HTML tag stripper ──────────────────────────────────────────────

/** Strip HTML tags, remove script/style/svg/noscript, decode entities, collapse whitespace. */
function stripHtml(html: string): string {
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
  return body;
}

// ── HTML ────────────────────────────────────────────────────────────────

function parseHtml(buf: Buffer): ParsedDocument | null {
  const html = buf.toString("utf-8");
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 120) : null;
  const body = stripHtml(html);
  if (body.length < 40) return null;
  return { text: body.slice(0, 500_000), title };
}

// ── PDF (pdfjs-dist) ─────────────────────────────────────────────────────
// Text extraction via pdfjs-dist - the same engine the OCR pipeline uses
// (ocr.ts). Replaced pdf-parse (2026-08-14): unmaintained, bundled an old
// pdf.js kernel, and duplicated the engine we already ship.

async function parsePdf(buf: Buffer): Promise<ParsedDocument | null> {
  let text: string | null = null;
  let pages: number | undefined;
  let title: string | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const getDocument = (pdfjs as unknown as {
      getDocument: (src: { data: Uint8Array }) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
          }>;
          getMetadata?: () => Promise<{ info?: { Title?: string } }>;
        }>;
      };
    }).getDocument;

    const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
    pages = doc.numPages;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        line += item.str ?? "";
        if (item.hasEOL) {
          parts.push(line);
          line = "";
        }
      }
      if (line.trim()) parts.push(line);
    }
    text = parts.join("\n").trim() || null;
    try {
      const meta = await doc.getMetadata?.();
      title = meta?.info?.Title?.trim() || null;
    } catch {
      /* document metadata is optional */
    }
  } catch {
    log.warn("[parser] pdfjs-dist extraction failed - will try OCR fallback");
  }
  if (text && text.length >= 10 && !isScannedPdf(text, pages)) {
    return { text: text.slice(0, 500_000), title, pages };
  }
  const ocrText = await ocrScannedPdf(buf);
  if (ocrText && ocrText.length >= 10) {
    return { text: ocrText.slice(0, 500_000), title, pages };
  }
  return null;
}

// ── Word .docx (mammoth) ────────────────────────────────────────────────

async function parseWord(buf: Buffer, filename: string): Promise<ParsedDocument | null> {
  // .docx -> mammoth.convertToHtml -> stripHtml (preserves table/list/heading structure)
  if (filename.toLowerCase().endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const result = await (mammoth as { convertToHtml: (opts: { buffer: Buffer }) => Promise<{ value: string }> })
        .convertToHtml({ buffer: buf });
      const text = stripHtml(result.value || "");
      if (!text || text.length < 10) return null;
      return { text: text.slice(0, 500_000), title: null };
    } catch {
      log.warn("[parser] mammoth not installed or .docx parse failed");
      return null;
    }
  }
  // .doc (legacy binary) - not supported without antiword/textract
  log.warn("[parser] .doc (legacy) not supported - convert to .docx");
  return null;
}

// ── Image (P7-4: OCR + vision description) ───────────────────────────────

async function parseImage(buf: Buffer): Promise<ParsedDocument | null> {
  // describeImage: vision-LLM caption when a provider is configured, OCR
  // otherwise (deterministic demo path) - either way the text is indexed and
  // the image document becomes retrievable.
  const desc = await describeImage(buf, "image/png");
  const text = desc?.text ?? "";
  if (!text || text.length < 10) return null;
  return { text: text.slice(0, 500_000), title: null };
}

// ── Subtitle .srt / .vtt (P7-4: 视频字幕提取) ─────────────────────────────
// Strips cue indexes, timestamps and inline tags - the dialogue text is what
// gets indexed, so subtitle queries hit the actual spoken content.

function parseSubtitle(buf: Buffer): ParsedDocument | null {
  const raw = buf.toString("utf-8");
  if (!raw.trim()) return null;

  // 1. remove inline tags (<i>, <font ...>, {\an8} style markers)
  const cleaned = raw
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // 2. strip cue index lines (pure digits)
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\d+$/.test(l));

  // 3. strip timestamp lines (HH:MM:SS,mmm --> ... / WEBVTT header / NOTE)
  const textLines = lines.filter((l) => {
    if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(l)) return false;
    if (/\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(l)) return false;
    if (/\d{1,2}:\d{2}\s*-->/.test(l)) return false;
    return true;
  });

  const text = textLines.join("\n").trim();
  if (text.length < 10) return null;
  return { text: text.slice(0, 500_000), title: null };
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
    log.warn("[parser] xlsx not installed - Excel parsing unavailable");
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
    log.warn("[parser] PPTX extraction failed");
    return null;
  }
}

// M-9: per-slide decompressed cap (zip-bomb guard) - a real slide XML is a
// few hundred KB at most; anything claiming more is a bomb and is skipped.
const MAX_SLIDE_XML = 1_000_000;

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
    // M-9: zip-bomb guard - the local header declares the compressed and
    // uncompressed sizes; a hostile file can declare a tiny compSize but
    // inflate to gigabytes. Cap both the slice AND the decompressed output.
    const compSize = buf.readUInt32LE(pos + 18);
    const uncompSize = buf.readUInt32LE(pos + 22);

    try {
      let xml: string;
      if (compMethod === 8) {
        // Deflate
        if (uncompSize > MAX_SLIDE_XML) continue; // declared expansion too big
        const compData = buf.subarray(compStart, compStart + compSize);
        // maxOutputLength throws ERR_BUFFER_TOO_LARGE / aborts inflate when the
        // output exceeds the cap - a compressed-bomb entry can't OOM the worker.
        const decompressed = zlib.inflateSync(compData, { maxOutputLength: MAX_SLIDE_XML });
        xml = decompressed.toString("utf-8");
      } else {
        // Stored (no compression)
        if (compSize > MAX_SLIDE_XML) continue;
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
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(ext)) return parseImage(buf);
  // Try as plain text
  return parseText(buf);
}
