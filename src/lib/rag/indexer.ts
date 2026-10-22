import { chunkText, smartChunk } from "./chunker";
import { indexChunks, clearDoc } from "./vector-store";
import { indexBM25, clearBM25Doc } from "./bm25";
import type { KbDocument, KbSettings } from "@/lib/kb/types";

// Parent-child chunk mapping: chunkKey -> parentText.
// Stored in-memory (same pattern as other globalThis stores). Used by the
// retriever to expand small child chunks into their larger parent context.
interface ParentMapStore {
  map: Map<string, string>;
}
function getParentStore(): ParentMapStore {
  const g = globalThis as unknown as { __KAI_PARENT_MAP__?: ParentMapStore };
  if (!g.__KAI_PARENT_MAP__) g.__KAI_PARENT_MAP__ = { map: new Map() };
  return g.__KAI_PARENT_MAP__;
}

export function getParentText(kbId: string, docId: string, chunkIndex: number): string | null {
  return getParentStore().map.get(`${kbId}:${docId}:${chunkIndex}`) ?? null;
}

function clearParentMap(kbId: string, docId: string): void {
  const store = getParentStore();
  const prefix = `${kbId}:${docId}:`;
  for (const key of [...store.map.keys()]) {
    if (key.startsWith(prefix)) store.map.delete(key);
  }
}

/**
 * 解析切片并写入向量/BM25 索引，返回**真实切片数**。
 * 早前返回 void，调用方只能先用 estimateChunks() 估算并写进 doc.chunks，
 * 导致 UI 显示「1 个切片」而实际有 5 个以上（估算与真实值偏离）。
 */
export async function indexDocument(doc: KbDocument, settings: KbSettings): Promise<number> {
  if (!doc.content || !doc.content.trim()) return 0;
  await clearDoc(doc.kbId, doc.id);
  clearBM25Doc(doc.kbId, doc.id);
  clearParentMap(doc.kbId, doc.id);

  const useParentChild = process.env.PARENT_CHILD_CHUNKING === "true";
  let chunks: string[];

  if (useParentChild) {
    const results = smartChunk(doc.content, {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
      addSectionPrefix: true,
      parentChild: true,
    });
    chunks = results.map((r) => r.text);
    const store = getParentStore();
    for (let i = 0; i < results.length; i++) {
      if (results[i].parentText) {
        store.map.set(`${doc.kbId}:${doc.id}:${i}`, results[i].parentText!);
      }
    }
  } else {
    chunks = chunkText(doc.content, settings.chunkSize, settings.chunkOverlap);
  }

  await Promise.all([
    indexChunks(doc.kbId, doc.id, doc.name, chunks),
    Promise.resolve(indexBM25(doc.kbId, doc.id, doc.name, chunks)),
  ]);
  return chunks.length;
}
