// ---------------------------------------------------------------------------
// Text splitter — character-based with overlap (approximates token chunking).
// 🔌 Integration point: swap for LangChain RecursiveCharacterTextSplitter
//    (token-aware) in production.
// ---------------------------------------------------------------------------

export function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= chunkSize) return clean ? [clean] : [];

  const step = Math.max(1, chunkSize - chunkOverlap);
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + chunkSize, clean.length);
    // try to break on a sentence/paragraph boundary near the end
    if (end < clean.length) {
      const boundary = clean.lastIndexOf("\n", end);
      if (boundary > i + chunkSize * 0.5) end = boundary;
    }
    const chunk = clean.slice(i, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    i += step;
  }
  return chunks;
}
