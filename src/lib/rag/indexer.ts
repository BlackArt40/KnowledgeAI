import { chunkText } from "./chunker";
import { indexChunks, clearDoc } from "./vector-store";
import { indexBM25, clearBM25Doc } from "./bm25";
import type { KbDocument, KbSettings } from "@/lib/kb/types";

// Index a document's text content into the per-KB vector store AND BM25 index.
// Called when a document reaches "ready". Async - uses LLM embeddings if configured.
export async function indexDocument(doc: KbDocument, settings: KbSettings) {
  if (!doc.content || !doc.content.trim()) return;
  await clearDoc(doc.kbId, doc.id);
  clearBM25Doc(doc.kbId, doc.id);

  const chunks = chunkText(doc.content, settings.chunkSize, settings.chunkOverlap);

  // Index into both vector store (semantic) and BM25 (keyword) in parallel
  await Promise.all([
    indexChunks(doc.kbId, doc.id, doc.name, chunks),
    Promise.resolve(indexBM25(doc.kbId, doc.id, doc.name, chunks)),
  ]);
}
