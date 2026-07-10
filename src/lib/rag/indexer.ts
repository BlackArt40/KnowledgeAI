import { chunkText } from "./chunker";
import { indexChunks, clearDoc } from "./vector-store";
import type { KbDocument, KbSettings } from "@/lib/kb/types";

// Index a document's text content into the per-KB vector store.
// Called when a document reaches "ready". Async - uses LLM embeddings if configured.
export async function indexDocument(doc: KbDocument, settings: KbSettings) {
  if (!doc.content || !doc.content.trim()) return;
  await clearDoc(doc.kbId, doc.id);
  const chunks = chunkText(doc.content, settings.chunkSize, settings.chunkOverlap);
  await indexChunks(doc.kbId, doc.id, doc.name, chunks);
}
