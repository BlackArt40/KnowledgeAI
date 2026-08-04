// External data source provider: Web search, web crawler, ArXiv, GitHub.
// Each source has an env-gated real implementation + a demo fallback.
// The provider pattern mirrors llm/billing/storage: env check -> real impl
// -> fallback -> register in config.ts getProviderStatus().

import type { ExternalResult, SourceConfig } from "./types";
import { qualityScore, deduplicateResults } from "./types";

// ── Source config (env-gated) ────────────────────────────────────────────
export function getSourceConfig(): SourceConfig {
  return {
    web: !!(process.env.TAVILY_API_KEY || process.env.SERPAPI_KEY || process.env.BRAVE_SEARCH_KEY),
    arxiv: true, // ArXiv API is free, no key needed
    github: !!process.env.GITHUB_TOKEN, // optional token for higher rate limit
  };
}

export function isExternalEnabled(): boolean {
  const cfg = getSourceConfig();
  return cfg.web || cfg.arxiv || cfg.github;
}

export function externalLabel(): string {
  const cfg = getSourceConfig();
  const parts: string[] = [];
  if (cfg.web) {
    if (process.env.TAVILY_API_KEY) parts.push("Tavily");
    else if (process.env.SERPAPI_KEY) parts.push("SerpAPI");
    else if (process.env.BRAVE_SEARCH_KEY) parts.push("Brave");
  }
  if (cfg.arxiv) parts.push("ArXiv");
  if (cfg.github) parts.push("GitHub");
  return parts.length > 0 ? parts.join(" + ") : "演示模式（模拟结果）";
}

// ── Web search (Tavily / SerpAPI / Brave) ────────────────────────────────
async function webSearch(query: string, maxResults = 5): Promise<ExternalResult[]> {
  if (process.env.TAVILY_API_KEY) {
    try { return await tavilySearch(query, maxResults); }
    catch (e) { console.error("[external] Tavily search failed:", e); }
  }
  if (process.env.SERPAPI_KEY) {
    try { return await serpApiSearch(query, maxResults); }
    catch (e) { console.error("[external] SerpAPI search failed:", e); }
  }
  if (process.env.BRAVE_SEARCH_KEY) {
    try { return await braveSearch(query, maxResults); }
    catch (e) { console.error("[external] Brave search failed:", e); }
  }
  return demoWebResults(query, maxResults);
}

async function tavilySearch(query: string, maxResults: number): Promise<ExternalResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query, max_results: maxResults, include_raw_content: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json() as { results: { title: string; url: string; content: string; score: number }[] };
  return (data.results ?? []).map((r) => ({
    id: `web:${r.url}`, sourceType: "web" as const,
    title: r.title, url: r.url, snippet: r.content.slice(0, 300),
    score: qualityScore(r.score ?? 0.5, r.url),
  }));
}

async function serpApiSearch(query: string, maxResults: number): Promise<ExternalResult[]> {
  const res = await fetch(
    `https://serpapi.com/search.json?api_key=${process.env.SERPAPI_KEY}&q=${encodeURIComponent(query)}&num=${maxResults}`
  );
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = await res.json() as { organic_results?: { title: string; link: string; snippet: string }[] };
  return (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
    id: `web:${r.link}`, sourceType: "web" as const,
    title: r.title, url: r.link, snippet: r.snippet ?? "",
    score: qualityScore(0.6, r.link),
  }));
}

async function braveSearch(query: string, maxResults: number): Promise<ExternalResult[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    { headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_KEY! } }
  );
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = await res.json() as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    id: `web:${r.url}`, sourceType: "web" as const,
    title: r.title, url: r.url, snippet: (r.description ?? "").slice(0, 300),
    score: qualityScore(0.55, r.url),
  }));
}

function demoWebResults(query: string, maxResults: number): ExternalResult[] {
  const topics = [
    { title: `${query} - 概述与背景`, snippet: `关于「${query}」的综合概述，涵盖定义、发展历程和核心概念。` },
    { title: `${query} - 最新趋势分析`, snippet: `「${query}」领域的最新发展趋势和未来方向预测。` },
    { title: `${query} - 技术细节与实现`, snippet: `「${query}」的关键技术原理和工程实践指南。` },
    { title: `${query} - 行业应用案例`, snippet: `「${query}」在不同行业的实际落地案例和效果评估。` },
  ];
  return topics.slice(0, maxResults).map((t, i) => ({
    id: `web:demo-${i}`, sourceType: "web" as const,
    title: t.title, url: `https://example.com/${encodeURIComponent(query)}/${i}`,
    snippet: t.snippet, score: qualityScore(0.7 - i * 0.1),
  }));
}

// ── Web crawler ───────────────────────────────────────────────────────────
export async function crawlUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "KnowledgeAI-Bot/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
  } catch { return null; }
}

export async function deepCrawl(results: ExternalResult[], topN = 3): Promise<ExternalResult[]> {
  const top = results.slice(0, topN);
  const crawled = await Promise.all(
    top.map(async (r) => {
      const fullText = await crawlUrl(r.url);
      return fullText ? { ...r, fullText } : r;
    })
  );
  return results.map((r) => crawled.find((c) => c.id === r.id) ?? r);
}

// ── ArXiv search ──────────────────────────────────────────────────────────
async function arxivSearch(query: string, maxResults = 5): Promise<ExternalResult[]> {
  try {
    const res = await fetch(
      `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) throw new Error(`ArXiv ${res.status}`);
    const xml = await res.text();
    return parseArxivXml(xml);
  } catch (e) {
    console.error("[external] ArXiv search failed:", e);
    return demoArxivResults(query, maxResults);
  }
}

function parseArxivXml(xml: string): ExternalResult[] {
  const results: ExternalResult[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml))) {
    const entry = match[1];
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
    const url = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? "";
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim();
    const authorMatch = entry.match(/<name>([\s\S]*?)<\/name>/);
    if (url) {
      results.push({
        id: `arxiv:${url}`, sourceType: "arxiv",
        title: title.replace(/\n/g, " ").trim(),
        url: url.replace("abs", "pdf"),
        snippet: summary.replace(/\n/g, " ").slice(0, 300),
        score: qualityScore(0.65, url, published),
        publishedAt: published, author: authorMatch?.[1]?.trim(),
      });
    }
  }
  return results;
}

function demoArxivResults(query: string, maxResults: number): ExternalResult[] {
  return Array.from({ length: Math.min(maxResults, 3) }, (_, i) => ({
    id: `arxiv:demo-${i}`, sourceType: "arxiv" as const,
    title: `${query}: A Comprehensive Study (Part ${i + 1})`,
    url: `https://arxiv.org/abs/2026.${10000 + i}`,
    snippet: `This paper presents a comprehensive study on ${query}, covering theoretical foundations, experimental results, and future directions.`,
    score: qualityScore(0.7 - i * 0.1, `https://arxiv.org/abs/2026.${10000 + i}`),
    publishedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    author: ["Zhang, Y.", "Li, M.", "Wang, X."][i] ?? "Unknown",
  }));
}

// ── GitHub search ─────────────────────────────────────────────────────────
async function githubSearch(query: string, maxResults = 5): Promise<ExternalResult[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "KnowledgeAI-Bot/1.0",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults}&sort=stars`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data = await res.json() as { items?: { full_name: string; html_url: string; description: string; stargazers_count: number; updated_at: string; owner: { login: string } }[] };
    return (data.items ?? []).slice(0, maxResults).map((repo) => ({
      id: `github:${repo.html_url}`, sourceType: "github" as const,
      title: repo.full_name, url: repo.html_url,
      snippet: (repo.description ?? `GitHub repository: ${repo.full_name} (★${repo.stargazers_count})`).slice(0, 300),
      score: qualityScore(Math.min(0.95, 0.4 + repo.stargazers_count / 100000), repo.html_url, repo.updated_at),
      publishedAt: repo.updated_at, author: repo.owner?.login,
    }));
  } catch (e) {
    console.error("[external] GitHub search failed:", e);
    return demoGithubResults(query, maxResults);
  }
}

function demoGithubResults(query: string, maxResults: number): ExternalResult[] {
  return Array.from({ length: Math.min(maxResults, 3) }, (_, i) => ({
    id: `github:demo-${i}`, sourceType: "github" as const,
    title: `${query.replace(/\s+/g, "-").toLowerCase()}-tool-${i + 1}`,
    url: `https://github.com/example/${query.replace(/\s+/g, "-").toLowerCase()}-${i + 1}`,
    snippet: `An open-source project related to ${query}. Includes documentation, examples, and community support. ★${(10 - i) * 1000}`,
    score: qualityScore(0.65 - i * 0.1, `https://github.com/example/${query}-${i + 1}`),
    publishedAt: new Date(Date.now() - i * 86_400_000 * 7).toISOString(),
    author: "example-org",
  }));
}

// ── Unified search: query all enabled sources, deduplicate, score ────────
export async function searchExternal(
  query: string,
  options?: { config?: SourceConfig; maxPerSource?: number; deepCrawlTopN?: number }
): Promise<ExternalResult[]> {
  const cfg = options?.config ?? getSourceConfig();
  const maxPerSource = options?.maxPerSource ?? 5;
  const all: ExternalResult[] = [];

  const tasks: Promise<ExternalResult[]>[] = [];
  if (cfg.web) tasks.push(webSearch(query, maxPerSource));
  if (cfg.arxiv) tasks.push(arxivSearch(query, maxPerSource));
  if (cfg.github) tasks.push(githubSearch(query, maxPerSource));

  if (tasks.length === 0) {
    // No sources enabled: return demo web results.
    all.push(...demoWebResults(query, maxPerSource));
  } else {
    const results = await Promise.all(tasks);
    for (const r of results) all.push(...r);
  }

  // Deduplicate by normalized URL (criterion #3).
  let deduped = deduplicateResults(all);

  // Deep crawl top-N web results for full text.
  const crawlN = options?.deepCrawlTopN ?? 0;
  if (crawlN > 0 && cfg.web) {
    deduped = await deepCrawl(deduped, crawlN);
  }

  return deduped;
}
