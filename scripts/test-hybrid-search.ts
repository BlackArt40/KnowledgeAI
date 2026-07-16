// @ts-nocheck
// P1-2 acceptance verification: reranking + query rewrite + hybrid search filters.
// Run: npx tsx scripts/test-hybrid-search.ts
async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. parseIndexList (reranker response parser) ──────────────────────
  const { parseIndexList } = await import("../src/lib/rag/reranker");
  check("parseIndexList: basic", JSON.stringify(parseIndexList("3,0,1,2", 4)) === "[3,0,1,2]");
  check("parseIndexList: with brackets/spaces", JSON.stringify(parseIndexList("[3], [0], 1 2", 4)) === "[3,0,1,2]");
  check("parseIndexList: dedup", parseIndexList("1,1,0,0", 2).length === 2);
  check("parseIndexList: out-of-range filtered", JSON.stringify(parseIndexList("0,5,1", 2)) === "[0,1]");
  check("parseIndexList: empty response", parseIndexList("", 5).length === 0);
  check("parseIndexList: garbage response", parseIndexList("not a list", 5).length === 0);

  // ── 2. parseQueryLines (query rewrite parser) ─────────────────────────
  const { parseQueryLines } = await import("../src/lib/rag/query-rewrite");
  check("parseQueryLines: basic", parseQueryLines("what is RAG\nhow does retrieval work\nRAG explanation", 3).length === 3);
  check("parseQueryLines: strips numbering", parseQueryLines("1. first\n2. second", 3)[0] === "first");
  check("parseQueryLines: dedup", parseQueryLines("same query\nsame query\ndifferent", 3).length === 2);
  check("parseQueryLines: empty lines filtered", parseQueryLines("\n\nreal query\n", 3).length === 1);
  check("parseQueryLines: caps at maxCount", parseQueryLines("a\nb\nc\nd\ne", 3).length === 3);

  // ── 3. rerank demo-mode fallback (no LLM) ─────────────────────────────
  const { rerank } = await import("../src/lib/rag/reranker");
  const chunks = [
    { docId: "d1", docName: "doc1", chunkIndex: 0, text: "chunk zero", score: 0.9 },
    { docId: "d2", docName: "doc2", chunkIndex: 0, text: "chunk one", score: 0.8 },
    { docId: "d3", docName: "doc3", chunkIndex: 0, text: "chunk two", score: 0.7 },
  ];
  const reranked = await rerank("test query", chunks, 2);
  check("rerank demo-mode returns original order", reranked.length === 2 && reranked[0].text === "chunk zero");
  check("rerank demo-mode truncates to topK", reranked.length === 2);

  // ── 4. rewriteQuery demo-mode fallback (no LLM) ───────────────────────
  const { rewriteQuery } = await import("../src/lib/rag/query-rewrite");
  const queries = await rewriteQuery("what is knowledge management");
  check("rewriteQuery demo-mode returns [original]", queries.length === 1 && queries[0] === "what is knowledge management");

  process.env.QUERY_REWRITE_ENABLED = "false";
  const disabled = await rewriteQuery("test");
  check("rewriteQuery disabled returns [original]", disabled.length === 1 && disabled[0] === "test");
  delete process.env.QUERY_REWRITE_ENABLED;

  // ── 5. hybridSearch with docIdFilter ──────────────────────────────────
  const { indexChunks } = await import("../src/lib/rag/vector-store");
  const { indexBM25 } = await import("../src/lib/rag/bm25");
  const { hybridSearch } = await import("../src/lib/rag/hybrid-search");
  const { embedText } = await import("../src/lib/llm/provider");

  const kbId = "test-kb-p12";
  const docChunks1 = ["Knowledge management is the process of creating sharing and managing knowledge.", "RAG combines retrieval with generation for accurate answers."];
  const docChunks2 = ["Machine learning models learn patterns from training data.", "Vector databases enable semantic search over embeddings."];

  await indexChunks(kbId, "docA", "knowledge-doc", docChunks1);
  indexBM25(kbId, "docA", "knowledge-doc", docChunks1);
  await indexChunks(kbId, "docB", "ml-doc", docChunks2);
  indexBM25(kbId, "docB", "ml-doc", docChunks2);

  const qv = await embedText("knowledge management RAG");
  const noFilter = await hybridSearch(kbId, "knowledge management RAG", qv, { topK: 4 });
  check("hybridSearch returns results without filter", noFilter.length > 0);

  const filteredResults = await hybridSearch(kbId, "knowledge management RAG", qv, { topK: 4, docIdFilter: ["docA"] });
  const allFromDocA = filteredResults.every((r) => r.docId === "docA");
  check("hybridSearch docIdFilter excludes non-matching docs", allFromDocA, `got docIds: ${filteredResults.map((r) => r.docId).join(",")}`);

  // ── 6. End-to-end retrieve (demo mode: rewrite no-op + rerank no-op) ──
  const { retrieve } = await import("../src/lib/rag/retriever");
  const retrieved = await retrieve(kbId, "knowledge management", 3);
  check("retrieve (demo mode) returns results", retrieved.length > 0, `got ${retrieved.length} results`);
  check("retrieve respects topK", retrieved.length <= 3);

  // ── 7. Reranker changes order when LLM gives explicit ranking ────────
  // Simulate: parseIndexList produces an order, verify rerank would use it.
  // (Full LLM reranking verified via manual testing with OPENAI_API_KEY set.)
  const order = parseIndexList("2,0,1", 3);
  const reordered = order.map((i) => chunks[i]);
  check("reranker parser produces reorderable indices", reordered[0].text === "chunk two" && reordered[1].text === "chunk zero");

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
