async function main() {
  const { parseDocument } = await import("../src/lib/rag/parser");
  const { docTypeFromName } = await import("../src/lib/kb/store");

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) { console.error(`❌ ${msg}`); failures++; }
    else console.log(`✅ ${msg}`);
  }

  assert(docTypeFromName("photo.png") === "image", "png => image");
  assert(docTypeFromName("photo.JPG") === "image", "JPG (uppercase) => image");
  assert(docTypeFromName("scan.jpeg") === "image", "jpeg => image");
  assert(docTypeFromName("anim.gif") === "image", "gif => image");
  assert(docTypeFromName("img.webp") === "image", "webp => image");

  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(400, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 100);
  ctx.fillStyle = "#000000";
  ctx.font = "36px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("IMAGE TEXT", 20, 25);
  const pngBuf = canvas.toBuffer("image/png");

  const imgParsed = await parseDocument(pngBuf, "photo.png", "image");
  assert(imgParsed !== null, "parseDocument(image) returns non-null");
  assert(imgParsed !== null && imgParsed.text.toUpperCase().includes("IMAGE"), `image OCR contains "IMAGE" (got: ${imgParsed!.text})`);

  // Digital text PDF (has a text layer) -> pdf-parse extracts text, no OCR.
  const pageW = 300, pageH = 300;
  const content = "BT /F1 12 Tf 20 280 Td (DIGITAL PDF TEXT) Tj ET";
  const contentBytes = Buffer.from(content, "latin1");
  function buildTextPdf(): Buffer {
    const chunks: Buffer[] = [];
    let p = 0;
    const off: number[] = [];
    const emit = (b: Buffer) => { chunks.push(b); p += b.length; };
    emit(Buffer.from("%PDF-1.4\n", "latin1"));
    off[1] = p; emit(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "latin1"));
    off[2] = p; emit(Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "latin1"));
    off[4] = p; emit(Buffer.from("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n", "latin1"));
    off[5] = p; emit(Buffer.from(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`, "latin1"));
    emit(contentBytes);
    emit(Buffer.from("\nendstream\nendobj\n", "latin1"));
    off[3] = p; emit(Buffer.from(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`, "latin1"));
    const xref = p;
    emit(Buffer.from("xref\n0 6\n0000000000 65535 f \n", "latin1"));
    for (let i = 1; i < 6; i++) {
      emit(Buffer.from(`${String(off[i]).padStart(10, "0")} 00000 n \n`, "latin1"));
    }
    emit(Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
    return Buffer.concat(chunks);
  }
  const textPdf = buildTextPdf();
  const pdfParsed = await parseDocument(textPdf, "doc.pdf", "pdf");
  console.log("Digital PDF parsed text:", JSON.stringify(pdfParsed?.text?.slice(0, 60)));
  assert(pdfParsed !== null, "digital PDF parses without OCR");
  assert(pdfParsed !== null && pdfParsed.text.includes("DIGITAL PDF TEXT"), `digital PDF text extracted (got: ${pdfParsed?.text?.slice(0, 60)})`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
