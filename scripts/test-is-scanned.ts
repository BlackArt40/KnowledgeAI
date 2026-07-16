async function main() {
  const { isScannedPdf } = await import("../src/lib/rag/ocr");

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) { console.error(`❌ ${msg}`); failures++; }
    else console.log(`✅ ${msg}`);
  }

  assert(isScannedPdf("", 5) === true, "empty text + 5 pages => scanned");
  assert(isScannedPdf("   \n  ", 3) === true, "whitespace-only => scanned");
  assert(isScannedPdf("a".repeat(30), 5) === true, "30 chars / 5 pages = 6/page < 20 => scanned");
  assert(isScannedPdf("a".repeat(200), 5) === false, "200 chars / 5 pages = 40/page >= 20 => not scanned");
  assert(isScannedPdf("a".repeat(5000), 1) === false, "5000 chars / 1 page => not scanned");
  assert(isScannedPdf("short", undefined) === true, "5 chars, no page info => scanned (< 50)");
  assert(isScannedPdf("a".repeat(60), undefined) === false, "60 chars, no page info => not scanned");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
