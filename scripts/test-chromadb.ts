// @ts-nocheck
// End-to-end test for ChromaVectorStore.
// Requires: ChromaDB running on localhost:8000
// Usage: VECTOR_STORE=chromadb npx tsx scripts/test-chromadb.ts

import { embed } from "../src/lib/rag/embeddings";

async function main() {
  process.env.VECTOR_STORE = "chromadb";
  process.env.CHROMA_URL = "http://localhost:8000";

  const { ChromaVectorStore } = await import("../src/lib/rag/vector-store-chromadb");
  const store = new ChromaVectorStore();

  const KB_ID = "test_kb_chroma_e2e";
  const DOC_ID = "doc_e2e_001";
  const DOC_NAME = "e2e_test_doc";

  console.log("[chroma] starting e2e test...\n");

  // 1. chunkCount on empty KB
  let count = await store.chunkCount(KB_ID);
  console.log(`1. chunkCount (empty): ${count} (expect 0)`);

  // 2. Index chunks
  const chunks = [
    "ChromaDB is an open-source vector database designed for AI applications.",
    "It provides high-performance similarity search with HNSW indexing.",
    "The REST API makes it easy to integrate with any programming language.",
  ];
  const vectors = chunks.map((c) => embed(c));
  await store.indexChunks(KB_ID, DOC_ID, DOC_NAME, chunks, vectors);
  console.log(`2. indexed ${chunks.length} chunks`);

  // 3. chunkCount after index
  count = await store.chunkCount(KB_ID);
  console.log(`3. chunkCount: ${count} (expect 3)`);
  if (count !== 3) { console.error("FAIL: expected 3 chunks"); process.exit(1); }

  // 4. Search with a query similar to chunk 0
  const queryVec = embed("ChromaDB vector database open-source");
  const results = await store.search(KB_ID, queryVec, 3);
  console.log(`4. search returned ${results.length} results`);
  for (const r of results) {
    console.log(`   score=${r.score.toFixed(4)} doc=${r.docId} idx=${r.chunkIndex} text="${r.text.slice(0, 50)}..."`);
  }
  if (results.length === 0) { console.error("FAIL: search returned 0 results"); process.exit(1); }
  // Best match should be chunk 0 (score > 0.5)
  if (results[0].score < 0.5) {
    console.error(`FAIL: best score too low: ${results[0].score}`);
    process.exit(1);
  }
  console.log("   best match score OK (>= 0.5)");

  // 5. Index a second doc
  const DOC_ID_2 = "doc_e2e_002";
  const chunks2 = [
    "The quick brown fox jumps over the lazy dog.",
    "Python is a popular programming language for data science.",
  ];
  const vectors2 = chunks2.map((c) => embed(c));
  await store.indexChunks(KB_ID, DOC_ID_2, "second_doc", chunks2, vectors2);
  count = await store.chunkCount(KB_ID);
  console.log(`5. indexed second doc, chunkCount: ${count} (expect 5)`);
  if (count !== 5) { console.error("FAIL: expected 5 chunks"); process.exit(1); }

  // 6. Re-index doc 1 (should replace, not duplicate)
  await store.indexChunks(KB_ID, DOC_ID, DOC_NAME, chunks, vectors);
  count = await store.chunkCount(KB_ID);
  console.log(`6. re-index doc1, chunkCount: ${count} (expect 5, not 8)`);
  if (count !== 5) { console.error("FAIL: expected 5 after re-index"); process.exit(1); }

  // 7. Clear doc 2
  await store.clearDoc(KB_ID, DOC_ID_2);
  count = await store.chunkCount(KB_ID);
  console.log(`7. clearDoc doc2, chunkCount: ${count} (expect 3)`);
  if (count !== 3) { console.error("FAIL: expected 3 after clearDoc"); process.exit(1); }

  // 8. Clear entire KB
  await store.clearKb(KB_ID);
  count = await store.chunkCount(KB_ID);
  console.log(`8. clearKb, chunkCount: ${count} (expect 0)`);
  if (count !== 0) { console.error("FAIL: expected 0 after clearKb"); process.exit(1); }

  console.log("\n[chroma] ✅ ALL TESTS PASSED");
}

main().catch((err) => {
  console.error("[chroma] ❌ Test failed:", err);
  process.exit(1);
});
