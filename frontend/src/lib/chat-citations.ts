// Extract [n] citations from streaming answer text. Extracted from ChatView so
// the ordering/dedup/out-of-range rules can be tested without an SFC mount.
import type { Citation } from "@/api/chat";

export interface LiveCitationSource {
  docId: string;
  docName: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  url?: string;
  sourceType?: string;
}

export function extractLiveCitations(
  text: string,
  sources: LiveCitationSource[]
): Citation[] {
  if (sources.length === 0) return [];
  const seen = new Set<number>();
  const citations: Citation[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10);
    if (n < 1 || n > sources.length || seen.has(n)) continue;
    seen.add(n);
    const s = sources[n - 1];
    citations.push({
      n,
      docId: s.docId,
      docName: s.docName,
      chunkIndex: s.chunkIndex,
      snippet: s.snippet,
      score: s.score,
      ...(s.url ? { url: s.url } : {}),
      ...(s.sourceType ? { sourceType: s.sourceType } : {}),
    });
  }
  return citations;
}
