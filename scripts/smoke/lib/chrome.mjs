// Shared Chrome binary resolution for the CDP-based UI smoke scripts.
//
// Historically every UI script hardcoded the macOS app path, so the whole
// group could only ever run on one developer machine. Resolution order:
//   1. CHROME_PATH / CHROME_BIN env (CI sets CHROME_PATH)
//   2. the common macOS / Linux install locations
// `resolveChrome()` still returns the first candidate when nothing exists so
// each script keeps its own "Chrome not found" error (with a CHROME_PATH hint).
import { existsSync } from "node:fs";

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].filter(Boolean);

export function resolveChrome() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  return CANDIDATES[0];
}

export const CHROME = resolveChrome();

export function chromeMissingMessage(path = CHROME) {
  return `Chrome not found at ${path} (install Chrome/Chromium or set CHROME_PATH)`;
}
