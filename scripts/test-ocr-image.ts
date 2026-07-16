async function main() {
  const { ocrImage } = await import("../src/lib/rag/ocr");

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) { console.error(`❌ ${msg}`); failures++; }
    else console.log(`✅ ${msg}`);
  }

  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(400, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 120);
  ctx.fillStyle = "#000000";
  ctx.font = "48px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("HELLO OCR", 30, 30);
  const pngBuf = canvas.toBuffer("image/png");

  const text = await ocrImage(pngBuf, "eng");
  console.log("OCR output:", JSON.stringify(text));
  assert(text !== null, "ocrImage returns non-null for a real image");
  assert(text !== null && text.toUpperCase().includes("HELLO"), `OCR text contains "HELLO" (got: ${text})`);

  process.env.OCR_ENABLED = "false";
  const disabled = await ocrImage(pngBuf, "eng");
  assert(disabled === null, "ocrImage returns null when OCR_ENABLED=false");
  delete process.env.OCR_ENABLED;

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
