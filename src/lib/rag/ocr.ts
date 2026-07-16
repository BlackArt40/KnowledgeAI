// ---------------------------------------------------------------------------
// OCR Pipeline - tesseract.js (image OCR) + pdfjs-dist (PDF page rendering).
//
// Used by parser.ts to OCR scanned PDFs (image-only pages with no text layer)
// and standalone images. All heavy deps are dynamically imported with graceful
// fallback: when a lib is missing or OCR_ENABLED=false, functions return null
// and the caller marks the document as "failed".
//
// Config (env):
//   OCR_ENABLED   (default true)  - master switch; false skips all OCR
//   OCR_LANG      (default eng+chi_sim) - tesseract language pack(s), '+'-joined
//   OCR_MAX_PAGES (default 20)    - cap pages OCR'd per scanned PDF
// ---------------------------------------------------------------------------

const MIN_CHARS_PER_PAGE = 20;
const MIN_CHARS_NO_PAGE_INFO = 50;

interface PdfCanvas {
  width: number;
  height: number;
  getContext(type: string): unknown;
  toBuffer(format: string): Buffer;
}

interface PdfTextItem {
  str: string;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<PdfTextContent>;
  render(opts: { canvasContext: unknown; viewport: { width: number; height: number } }): { promise: Promise<void> };
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

export function isScannedPdf(text: string, pages?: number): boolean {
  const t = text ?? "";
  if (pages && pages > 0) {
    return t.length / pages < MIN_CHARS_PER_PAGE;
  }
  return t.length < MIN_CHARS_NO_PAGE_INFO;
}

function ocrEnabled(): boolean {
  return process.env.OCR_ENABLED !== "false";
}

function ocrLang(): string {
  return process.env.OCR_LANG || "eng+chi_sim";
}

function ocrMaxPages(): number {
  const v = parseInt(process.env.OCR_MAX_PAGES || "20", 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

export async function ocrImage(buf: Buffer, lang?: string): Promise<string | null> {
  if (!ocrEnabled()) return null;
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(lang ?? ocrLang(), 1, {});
    try {
      const { data } = await worker.recognize(buf);
      return data?.text?.trim() || null;
    } finally {
      await worker.terminate().catch(() => {});
    }
  } catch (err) {
    console.warn("[ocr] tesseract.js unavailable or recognition failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function ocrScannedPdf(
  buf: Buffer,
  opts?: { lang?: string; maxPages?: number }
): Promise<string | null> {
  if (!ocrEnabled()) return null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const canvasMod = await import("@napi-rs/canvas");
    const createCanvas = (canvasMod as { createCanvas: (w: number, h: number) => PdfCanvas }).createCanvas;

    const getDocument = (pdfjs as unknown as {
      getDocument: (opts: { data: Uint8Array }) => { promise: Promise<PdfDocument> };
    }).getDocument;
    const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
    const total = pdf.numPages;
    const limit = Math.min(total, opts?.maxPages ?? ocrMaxPages());
    const parts: string[] = [];

    for (let i = 1; i <= limit; i++) {
      try {
        const page = await pdf.getPage(i);
        let pageText: string | null = null;
        try {
          const tc = await page.getTextContent();
          const direct = tc.items.map((it) => it.str).join(" ").trim();
          if (direct.length >= 10) pageText = direct;
        } catch {
          // getTextContent unavailable/failed on this page -> fall through to OCR
        }
        if (!pageText) {
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = createCanvas(viewport.width, viewport.height);
          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport }).promise;
          const pngBuf = canvas.toBuffer("image/png");
          pageText = await ocrImage(pngBuf, opts?.lang);
        }
        if (pageText) parts.push(pageText);
        page.cleanup();
      } catch (err) {
        console.warn(`[ocr] page ${i} extraction failed, skipping:`, err instanceof Error ? err.message : err);
      }
    }
    if (total > limit) {
      console.warn(`[ocr] PDF has ${total} pages, OCR'd first ${limit} (OCR_MAX_PAGES)`);
    }
    await pdf.destroy();
    const result = parts.join("\n\n").trim();
    return result.length > 0 ? result : null;
  } catch (err) {
    console.warn("[ocr] scanned PDF OCR pipeline failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export const __test = { ocrEnabled, ocrLang, ocrMaxPages };
export type { PdfCanvas, PdfPage, PdfDocument };
