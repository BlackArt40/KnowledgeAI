// @ts-nocheck
// P2-2 acceptance verification: external data sources (web/arxiv/github),
// source type + URL labeling, dedup + quality scoring.
// Run: npx tsx scripts/smoke/test-external-sources.ts
async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. Provider config + demo fallback (criterion #1: internal + external) ─
  const { getSourceConfig, isExternalEnabled, searchExternal } = await import("../../src/lib/external/provider");
  const { deduplicateResults, normalizeUrl, qualityScore } = await import("../../src/lib/external/types");
  const { ExternalResult } = {};

  const cfg = getSourceConfig();
  check("config: arxiv always enabled (free API)", cfg.arxiv === true);
  check("config: web depends on API key", cfg.web === !!process.env.TAVILY_API_KEY || !!process.env.SERPAPI_KEY || !!process.env.BRAVE_SEARCH_KEY);
  check("config: github depends on token", cfg.github === !!process.env.GITHUB_TOKEN);

  // ── 2. Web search (demo fallback when no API key) ─────────────────────
  const webResults = await searchExternal("RAG retrieval augmented generation", { maxPerSource: 3, deepCrawlTopN: 0 });
  check("web search: returns results (demo or real)", webResults.length > 0);
  check("web search: results have sourceType", webResults.every((r) => ["web", "arxiv", "github"].includes(r.sourceType)));
  check("web search: results have URL (criterion #2)", webResults.every((r) => r.url.startsWith("http")));
  check("web search: results have title", webResults.every((r) => r.title.length > 0));
  check("web search: results have snippet", webResults.every((r) => r.snippet.length > 0));
  check("web search: results have score 0-1 (criterion #3)", webResults.every((r) => r.score >= 0 && r.score <= 1));

  // ── 3. Source type labeling (criterion #2) ────────────────────────────
  // Each result must carry a sourceType (web/arxiv/github) and a URL.
  const allResults = webResults;
  const webCount = allResults.filter((r) => r.sourceType === "web").length;
  const arxivCount = allResults.filter((r) => r.sourceType === "arxiv").length;
  const githubCount = allResults.filter((r) => r.sourceType === "github").length;
  check("source types: at least one web/arxiv/github result present", webCount + arxivCount + githubCount > 0);
  check("source types: every result has sourceType (criterion #2)", allResults.every((r) => ["web", "arxiv", "github"].includes(r.sourceType)));
  check("source types: every result has canonical URL (criterion #2)", allResults.every((r) => /^https?:\/\//.test(r.url)));

  // ── 4. Deduplication (criterion #3) ───────────────────────────────────
  const dedupInput = [
    { id: "a", sourceType: "web", title: "T1", url: "https://example.com/page", snippet: "short", score: 0.7 },
    { id: "b", sourceType: "web", title: "T2", url: "https://example.com/page/", snippet: "longer snippet text here", score: 0.6 },
    { id: "c", sourceType: "arxiv", title: "T3", url: "https://arxiv.org/abs/1234", snippet: "Paper abstract", score: 0.8 },
    { id: "d", sourceType: "github", title: "T4", url: "https://github.com/repo", snippet: "Repo desc", score: 0.5 },
  ];
  const deduped = deduplicateResults(dedupInput);
  check("dedup: a and b are same URL (trailing slash)", deduped.length === 3, `got ${deduped.length}`);
  check("dedup: merged snippet is longer one", deduped.find((r) => r.url.includes("example.com"))?.snippet === "longer snippet text here");
  check("dedup: merged score is max (0.7)", deduped.find((r) => r.url.includes("example.com"))?.score === 0.7);
  check("dedup: sorted by score descending", deduped[0].score >= deduped[1].score);

  // ── 5. Quality scoring (criterion #3) ─────────────────────────────────
  const baseScore = qualityScore(0.5);
  check("quality: base score 0.5", baseScore === 0.5);
  const arxivBoost = qualityScore(0.5, "https://arxiv.org/abs/1234");
  check("quality: arxiv domain gets authority boost", arxivBoost > 0.5, `got ${arxivBoost}`);
  const githubBoost = qualityScore(0.5, "https://github.com/repo");
  check("quality: github domain gets authority boost", githubBoost > 0.5, `got ${githubBoost}`);
  const recentBoost = qualityScore(0.5, undefined, new Date(Date.now() - 10 * 86_400_000).toISOString());
  check("quality: recent (10-day) gets recency boost", recentBoost > 0.5, `got ${recentBoost}`);
  const oldNoBoost = qualityScore(0.5, undefined, new Date(Date.now() - 200 * 86_400_000).toISOString());
  check("quality: old (200-day) gets no recency boost", oldNoBoost === 0.5, `got ${oldNoBoost}`);
  check("quality: score capped at 1.0", qualityScore(1.5) === 1.0);
  check("quality: negative score clamped to 0", qualityScore(-0.5) === 0);

  // ── 6. URL normalization (dedup helper) ───────────────────────────────
  check("normalizeUrl: strips trailing slash", normalizeUrl("https://example.com/page/") === "https://example.com/page");
  check("normalizeUrl: lowercases hostname", normalizeUrl("https://EXAMPLE.COM/Page") === "https://example.com/Page");
  check("normalizeUrl: strips fragment", normalizeUrl("https://example.com/page#section") === "https://example.com/page");
  check("normalizeUrl: handles invalid URL gracefully", normalizeUrl("not-a-url") === "not-a-url");

  // ── 7. Crawl function (graceful degradation) ──────────────────────────
  const { crawlUrl } = await import("../../src/lib/external/provider");
  const crawlResult = await crawlUrl("https://nonexistent-website-12345.com");
  check("crawl: returns null on fetch failure", crawlResult === null);

  // ── 8. Integration: orchestrator uses external sources (criterion #1) ──
  // Verify the orchestrator imports external sources (static check).
  const orchSource = await read_file("../../src/lib/agent/orchestrator.ts");
  check("orchestrator: imports searchExternal", orchSource.includes("searchExternal"));
  check("orchestrator: imports isExternalEnabled", orchSource.includes("isExternalEnabled"));
  check("orchestrator: citations include external source types", orchSource.includes("sourceType"));

  // ── 9. Config.ts registers external provider ──────────────────────────
  const configSource = await read_file("../../src/lib/config.ts");
  check("config: registers external provider in getProviderStatus", configSource.includes("external"));
  check("config: externalLabel imported", configSource.includes("externalLabel"));

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function read_file(path: string): Promise<string> {
  const fs = await import("fs");
  return fs.readFileSync(new URL(path, import.meta.url), "utf-8");
}

main();
