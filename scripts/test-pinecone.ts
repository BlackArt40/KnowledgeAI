// @ts-nocheck
// End-to-end test for PineconeVectorStore against a mock Pinecone server.
// Usage: npx tsx scripts/test-pinecone.ts
import { embed } from "../src/lib/rag/embeddings";

async function main() {
  process.env.VECTOR_STORE = "pinecone";
  process.env.PINECONE_API_KEY = "test-key";
  process.env.PINECONE_INDEX_HOST = "http://localhost:5080";

  const { PineconeVectorStore } = await import("../src/lib/rag/vector-store-pinecone");
  const store = new PineconeVectorStore();

  const KB_ID = "test_kb_pinecone_e2e";
  const DOC_ID = "doc_pinecone_001";
  const DOC_NAME = "pinecone_test_doc";

  console.log("[pinecone] starting e2e test...\n");

  // 1. chunkCount on empty KB
  let count = await store.chunkCount(KB_ID);
  console.log(`1. chunkCount (empty): ${count} (expect 0)`);

  // 2. Index chunks
  const chunks = [
    "Pinecone is a managed vector database optimized for serverless workloads.",
    "It provides low-latency ANN search with namespace-based isolation.",
    "The data plane REST API supports upsert, query, and delete operations.",
  ];
  const vectors = chunks.map((c) => embed(c));
  await store.indexChunks(KB_ID, DOC_ID, DOC_NAME, chunks, vectors);
  console.log(`2. indexed ${chunks.length} chunks`);

  // 3. chunkCount after index
  count = await store.chunkCount(KB_ID);
  console.log(`3. chunkCount: ${count} (expect 3)`);
  if (count !== 3) { console.error("FAIL: expected 3 chunks"); process.exit(1); }

  // 4. Search
  const queryVec = embed("managed vector database serverless");
  const results = await store.search(KB_ID, queryVec, 3);
  console.log(`4. search returned ${results.length} results`);
  for (const r of results) {
    console.log(`   score=${r.score.toFixed(4)} doc=${r.docId} idx=${r.chunkIndex} text="${r.text.slice(0, 50)}..."`);
  }
  if (results.length === 0) { console.error("FAIL: search returned 0 results"); process.exit(1); }
  if (results[0].score < 0.5) { console.error(`FAIL: best score too low: ${results[0].score}`); process.exit(1); }
  console.log("   best match score OK (>= 0.5)");

  // 5. Index a second doc
  const DOC_ID_2 = "doc_pinecone_002";
  const chunks2 = [
    "The quick brown fox jumps over the lazy dog.",
    "TypeScript provides static type checking for JavaScript.",
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

  console.log("\n[pinecone] ✅ ALL TESTS PASSED");
}

main().catch((err) => {
  console.error("[pinecone] ❌ Test failed:", err);
  process.exit(1);
});
