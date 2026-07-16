// Builds a minimal 1-page PDF whose only content is a JPEG image of text.
// This simulates a "scanned" PDF (no text layer) for OCR fallback testing.
async function main() {
  const { ocrScannedPdf, isScannedPdf } = await import("../src/lib/rag/ocr");

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) { console.error(`❌ ${msg}`); failures++; }
    else console.log(`✅ ${msg}`);
  }

  const { createCanvas } = await import("@napi-rs/canvas");
  const pageW = 600, pageH = 150;
  const canvas = createCanvas(pageW, pageH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageW, pageH);
  ctx.fillStyle = "#000000";
  ctx.font = "56px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("SCANNED", 40, 40);
  const jpeg = canvas.toBuffer("image/jpeg");

  function buildJpegPdf(img: Buffer): Buffer {
    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = Buffer.from(content, "latin1");
    const chunks: Buffer[] = [];
    let p = 0;
    const off: number[] = [];
    const emit = (b: Buffer) => { chunks.push(b); p += b.length; };
    emit(Buffer.from("%PDF-1.4\n", "latin1"));
    off[1] = p; emit(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "latin1"));
    off[2] = p; emit(Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "latin1"));
    off[4] = p; emit(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pageW} /Height ${pageH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`, "latin1"));
    emit(img);
    emit(Buffer.from("\nendstream\nendobj\n", "latin1"));
    off[5] = p; emit(Buffer.from(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`, "latin1"));
    emit(contentBytes);
    emit(Buffer.from("\nendstream\nendobj\n", "latin1"));
    off[3] = p; emit(Buffer.from(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`, "latin1"));
    const xref = p;
    emit(Buffer.from(`xref\n0 6\n0000000000 65535 f \n`, "latin1"));
    for (let i = 1; i < 6; i++) {
      emit(Buffer.from(`${String(off[i]).padStart(10, "0")} 00000 n \n`, "latin1"));
    }
    emit(Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
    return Buffer.concat(chunks);
  }

  const pdfBuf = buildJpegPdf(jpeg);
  console.log("Built scanned PDF:", pdfBuf.length, "bytes");

  try {
    const pp = await import("pdf-parse");
    const pdfParse = (pp as { default?: (b: Buffer) => Promise<{ text: string; numpages?: number }> }).default
      || (pp as unknown as (b: Buffer) => Promise<{ text: string; numpages?: number }>);
    const d = await pdfParse(pdfBuf);
    console.log("pdf-parse text length:", d.text?.length, "pages:", d.numpages);
    assert(isScannedPdf(d.text || "", d.numpages), "isScannedPdf flags the image-only PDF");
  } catch (e) {
    console.log("pdf-parse check skipped:", e instanceof Error ? e.message : e);
  }

  const ocrText = await ocrScannedPdf(pdfBuf, { lang: "eng", maxPages: 5 });
  console.log("OCR output:", JSON.stringify(ocrText));
  assert(ocrText !== null, "ocrScannedPdf returns non-null");
  assert(ocrText !== null && ocrText.toUpperCase().includes("SCANNED"), `OCR text contains "SCANNED" (got: ${ocrText})`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
