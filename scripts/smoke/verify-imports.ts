// Verifies all six parser/OCR dependencies resolve via dynamic import.
async function main() {
  const checks: Array<[string, string]> = [
    ["pdf-parse", "pdf-parse"],
    ["mammoth", "mammoth"],
    ["xlsx", "xlsx"],
    ["tesseract.js", "tesseract.js"],
    ["pdfjs-dist/legacy/build/pdf.mjs", "pdfjs-dist/legacy/build/pdf.mjs"],
    ["@napi-rs/canvas", "@napi-rs/canvas"],
  ];

  let ok = 0;
  for (const [label, mod] of checks) {
    try {
      await import(mod);
      console.log(`✅ ${label}`);
      ok++;
    } catch (e) {
      console.error(`❌ ${label}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`\n${ok}/${checks.length} imports resolved`);
  process.exit(ok === checks.length ? 0 : 1);
}

main();
