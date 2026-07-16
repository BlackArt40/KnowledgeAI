# P1-1 Multi-format Document Parsing — Design Spec

> **Roadmap item**: P1-1 多格式文档解析 (`docs/ROADMAP.md`)
> **Date**: 2026-07-15
> **Status**: Approved (Approach A — extract OCR to its own module)

## 1. Goal

Complete P1-1's two unchecked roadmap items and satisfy all three acceptance criteria.

**Unchecked roadmap items:**
- 接入 Word 解析（`mammoth` .docx -> HTML -> 文本）
- OCR 支持：扫描版 PDF / 图片文字识别

**Acceptance criteria:**
1. 支持 PDF / DOCX / XLSX / PPTX / MD / TXT / HTML / CSV 共 8 种格式
2. PDF 表格内容正确提取（门槛：文本级提取，内容不丢失/不乱码即可）
3. 扫描版 PDF 通过 OCR 可索引

## 2. Current state (verified)

- `src/lib/rag/parser.ts` already contains `parsePdf` (pdf-parse), `parseWord` (mammoth `extractRawText`), `parseExcel` (xlsx), `parsePptx` (built-in ZIP/XML). All optional libs are **dynamic-imported with graceful fallback** (return null + `console.warn` when missing) — the doc is then marked "failed".
- `pdf-parse`, `mammoth`, `xlsx` are **NOT in `package.json`** and not installed → PDF/Word/Excel parsing currently silently fails. PPTX/MD/TXT/CSV/HTML work (no external deps).
- `mammoth` uses `extractRawText` (direct text); roadmap specifies the `.docx -> HTML -> 文本` route (preserves table/list/heading structure better for RAG).
- **No OCR code exists.** No `tesseract.js`, `pdfjs-dist`, or canvas lib installed. No OCR env config.
- `DocType = "pdf" | "word" | "markdown" | "text" | "web" | "csv" | "other"` — no `"image"` type.
- `storage/index.ts` `ALLOWED_EXTENSIONS` does not permit image extensions.
- Parsing runs in the background queue: `doc-process` handler → `processDocInQueue` → `parseDocument(buf, name, type)` → chunk → vectorize → index.

## 3. Design decisions (confirmed with user)

| Decision | Choice | Rationale |
| --- | --- | --- |
| OCR stack | `tesseract.js` + `pdfjs-dist` + `@napi-rs/canvas`, self-contained | Pure JS/WASM, no external binary, offline-capable; matches project's "config即切换 + graceful fallback" pattern. User selected. |
| PDF table bar | Text-level extraction (content not lost/garbled) | YAGNI for RAG indexing; avoids extra table-aware lib with poor Node ecosystem support. User selected. |
| Word route | `mammoth.convertToHtml` -> strip tags | Roadmap explicitly specifies `.docx -> HTML -> 文本`; preserves structure for RAG. |
| Image OCR | Include (add `"image"` DocType) | Roadmap says "图片文字识别"; tesseract.js handles images natively; low marginal cost. |
| Code structure | Approach A — new `src/lib/rag/ocr.ts` module | Isolates the only genuinely complex new logic (PDF->image->OCR pipeline) as a testable deep module; keeps `parser.ts` focused; no unrelated refactor. |

## 4. Architecture

### 4.1 New module: `src/lib/rag/ocr.ts`

Isolated OCR pipeline. All exports are async, dynamic-import, graceful-fallback (return null + warn when a dep is missing).

```typescript
// Public API
export function isScannedPdf(text: string, pages?: number): boolean;
export async function ocrImage(buf: Buffer, lang?: string): Promise<string | null>;
export async function ocrScannedPdf(buf: Buffer, opts?: { lang?: string; maxPages?: number }): Promise<string | null>;
```

- **`isScannedPdf(text, pages?)`** — heuristic: if `pages` known, scanned when `text.length / pages < 20`; if unknown, scanned when `text.length < 50`. Threshold constants module-private and tuned for typical scanned docs (near-zero extractable text).
- **`ocrImage(buf, lang?)`** — dynamic `import("tesseract.js")`; create a `createWorker(lang ?? OCR_LANG)`, `recognize(buf)`, return `data.text`. Single image. Returns null if tesseract.js missing or `OCR_ENABLED=false`.
- **`ocrScannedPdf(buf, opts?)`** — dynamic `import("pdfjs-dist/legacy/build/pdf.js")` + `import("@napi-rs/canvas")`. For each page (capped at `OCR_MAX_PAGES`): `page.render({ canvasFactory })` to a canvas → `canvas.toBuffer("png")` → `ocrImage(pngBuf)`. Concatenate per-page text with page separators. Per-page errors are logged and skipped (one bad page does not abort the whole doc). Returns null if either dep missing or `OCR_ENABLED=false`.
- **Config reads**: `OCR_ENABLED` (default `true`), `OCR_LANG` (default `eng+chi_sim` — CJK+English for this project), `OCR_MAX_PAGES` (default `20`). Read via `process.env` at call time (consistent with other providers).

### 4.2 `parser.ts` changes

- **Refactor**: extract `stripHtml(html: string): { text: string; title: string | null }` from the inline logic in `parseHtml`, so both `parseHtml` and `parseWord` share it. (`parseHtml` reads title from raw HTML before stripping; `parseWord` has no `<title>` so passes `title: null`.)
- **`parseWord(buf, filename)`** — for `.docx`: dynamic `import("mammoth")` → `convertToHtml({ buffer: buf })` → `stripHtml(html).text`. Returns `{ text, title: null }`. `.doc` legacy binary remains unsupported (warn + null, unchanged).
- **`parsePdf(buf)`** — after `pdfParse(buf)`: if `text` is empty/too short **and** `isScannedPdf(text, pages)` → call `ocrScannedPdf(buf)`; if OCR returns text, use it (with `pages` preserved). If pdf-parse itself throws AND the buffer looks like a PDF (`%PDF`), also attempt OCR fallback. Normal digital PDFs (sufficient text) skip OCR entirely (fast path).
- **New `parseImage(buf)`** — delegates to `ocr.ocrImage(buf)`; returns `{ text, title: null }` or null.
- **`parseDocument` switch** — add `case "image": return parseImage(buf);`.
- **`parseByExtension`** — add `if (ext endsWith .png/.jpg/.jpeg/.gif/.webp/.bmp) return parseImage(buf);`.
- Preserve the 500,000-char text cap and the "length < 10 ⇒ null" guards already present.

### 4.3 DocType expansion (bounded blast radius)

| File | Change |
| --- | --- |
| `src/lib/kb/types.ts` | `DocType` union adds `"image"`. |
| `src/lib/kb/store.ts` | `docTypeFromName`: `.png/.jpg/.jpeg/.gif/.webp/.bmp` → `"image"`. `isTextLike` unchanged (image is not text-like; it already returns true only for markdown/text/csv). |
| `src/components/app/kb/doc-type-icon.tsx` | Add `image: { icon: FileImage, cls: "bg-pink-500/12 text-pink-500" }` to the `Record<DocType, ...>` (TypeScript forces this). |
| `src/lib/storage/index.ts` | `ALLOWED_EXTENSIONS` adds `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`. |

`docTypeFromName` is called by both upload routes and `addDocument`; no route-handler changes needed (the type flows through automatically).

### 4.4 Configuration (`.env.example`)

Append a new "OCR" section:
```
# OCR (scanned PDF / image text recognition). Self-contained via tesseract.js + pdfjs-dist.
OCR_ENABLED=true                  # master switch; false skips all OCR (fast path for digital-only docs)
OCR_LANG=eng+chi_sim              # tesseract language pack(s); CJK+English default
OCR_MAX_PAGES=20                  # cap OCR pages per scanned PDF to bound worker time
```

### 4.5 Data flow

```
upload route → validateFile (whitelist now allows images)
  → addDocument → docTypeFromName (returns "image" for images)
  → queue: doc-process → processDocInQueue → parseDocument(buf, name, type)
      switch(type):
        pdf    → parsePdf → (digital: pdf-parse text) | (scanned: ocrScannedPdf fallback)
        word   → parseWord (mammoth convertToHtml → stripHtml)
        image  → parseImage → ocr.ocrImage
        excel  → parseExcel (xlsx)            [unchanged]
        pptx   → parsePptx (built-in)         [unchanged, via "other"→parseByExtension]
        text/md/csv → parseText               [unchanged]
        web/html    → parseHtml               [unchanged]
  → chunk → vectorize → index                 [unchanged]
```

## 5. Error handling

- Missing optional dep (any of pdf-parse/mammoth/xlsx/tesseract.js/pdfjs-dist/canvas) → `console.warn` + return null → doc marked "failed" with a helpful message. Preserves existing behavior.
- `OCR_ENABLED=false` → OCR functions return null immediately (no dynamic import attempted). Digital PDFs still parse via pdf-parse; scanned PDFs fail with a clear "OCR disabled" message.
- OCR per-page failure → log warning, skip that page, continue remaining pages. Partial text is still indexed.
- `OCR_MAX_PAGES` exceeded → OCR first N pages, log that remaining pages were skipped.
- mammoth HTML conversion failure → fall back to `extractRawText` if available, else null. (Defensive: convertToHtml is the primary path; extractRawText as secondary.)

## 6. Testing

The project has no unit test framework; tests are standalone Node scripts (per `AGENTS.md`). Consistent with the `scripts/test-*.ts` (run via `npx tsx`) convention:

- New **`scripts/test-parser.ts`** — exercises `parseDocument` for all 8 formats + scanned-PDF OCR + image OCR:
  - Generates small in-memory fixtures for TXT/MD/CSV/HTML (strings).
  - Commits tiny binary fixtures under `scripts/samples/` for PDF/DOCX/XLSX/PPTX (minimal valid files; a scanned PDF = a PDF containing a page image of text).
  - Asserts each format returns non-null `text` of reasonable length.
  - Asserts scanned-PDF fixture triggers OCR fallback (text matches the embedded image content).
  - Asserts image fixture returns OCR text.
- Manual smoke: `npx tsx scripts/test-parser.ts`. Not in CI (matches project convention).
- Also verify the upload flow end-to-end via `pnpm dev` + the existing `tests/functional/functional-test.mjs` still passes (regression check).

## 7. Acceptance criteria mapping

| Criterion | How met | Verification |
| --- | --- | --- |
| 8 formats (PDF/DOCX/XLSX/PPTX/MD/TXT/HTML/CSV) | Install pdf-parse/mammoth/xlsx; PPTX/MD/TXT/HTML/CSV already work | `scripts/test-parser.ts` asserts all 8 return non-null text |
| PDF table content correctly extracted | pdf-parse extracts table cell text (text-level); scanned tables via OCR | `test-parser.ts` PDF fixture containing a table; assert key cell values present in output |
| Scanned PDF indexable via OCR | `parsePdf` detects low-text → `ocrScannedPdf` (pdfjs-dist render + tesseract.js) → indexed | `test-parser.ts` scanned-PDF fixture; assert OCR text matches embedded content |

## 8. Out of scope

- Structured/markdown table extraction from digital PDFs (agreed text-level is sufficient).
- `.doc` legacy binary support (still unsupported; warn + null).
- OCR of non-Latin/CJK beyond the configured `OCR_LANG` packs.
- Refactoring working parsers into a `parsers/` directory (Approach C, rejected as unrelated churn).
- PDF form-field / annotation extraction.
