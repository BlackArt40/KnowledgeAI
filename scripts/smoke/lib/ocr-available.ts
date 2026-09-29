// OCR availability probe shared by the smoke scripts that assert OCR output.
//
// Mirrors `packsAvailable()` in src/lib/rag/ocr.ts: tesseract can only run when
// every requested language pack is cached under .tessdata/ (gitignored, so it
// is absent on a fresh clone and in CI). When OCR cannot run the parser
// contract is "return null / fall back", NOT "return wrong text" - so the
// OCR-dependent assertions in those scripts must SKIP instead of FAIL.
import fs from "node:fs";

/** True when OCR is enabled and every pack of `lang` exists in .tessdata/. */
export function ocrAvailable(lang = process.env.OCR_LANG || "eng+chi_sim"): boolean {
  if (process.env.OCR_ENABLED === "false") return false;
  return lang
    .split("+")
    .filter(Boolean)
    .every((part) => fs.existsSync(`.tessdata/${part}.traineddata`));
}

/** One-line reason to print next to a skipped OCR assertion. */
export function ocrSkipReason(lang = process.env.OCR_LANG || "eng+chi_sim"): string {
  return process.env.OCR_ENABLED === "false"
    ? "SKIP (OCR_ENABLED=false)"
    : `SKIP (tesseract language packs ${lang} missing in .tessdata/ - run scripts/smoke/test-ocr-image.ts once online to cache them)`;
}
