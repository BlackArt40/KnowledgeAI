// External data source types.
// A RetrievedChunk from external sources carries sourceType + url metadata
// so the agent report can cite where information came from (criterion #2).

/** Source type for provenance tracking (criterion #2: source type + URL). */
export type SourceType = "internal" | "web" | "arxiv" | "github";

/** A unified external result that maps to RetrievedChunk for the agent pipeline. */
export interface ExternalResult {
  /** Unique id (used for dedup). */
  id: string;
  sourceType: SourceType;
  /** Display title. */
  title: string;
  /** Canonical URL for citation. */
  url: string;
  /** Snippet/abstract text. */
  snippet: string;
  /** Full text (from deep crawl, optional). */
  fullText?: string;
  /** Quality score 0-1 (criterion #3: quality scoring). */
  score: number;
  /** Published date (ISO string, optional). */
  publishedAt?: string;
  /** Author/source site. */
  author?: string;
}

/** Which external sources are enabled. Driven by env vars + user config. */
export interface SourceConfig {
  web: boolean;
  arxiv: boolean;
  github: boolean;
}

/** Deduplicate results by URL (normalized) and merge snippets/fullText.
 *  Keeps the highest score among duplicates (criterion #3: dedup). */
export function deduplicateResults(results: ExternalResult[]): ExternalResult[] {
  const seen = new Map<string, ExternalResult>();
  for (const r of results) {
    const key = normalizeUrl(r.url);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...r });
    } else {
      // Merge: keep higher score, prefer longer snippet, keep fullText if any.
      existing.score = Math.max(existing.score, r.score);
      if (r.snippet.length > existing.snippet.length) existing.snippet = r.snippet;
      if (r.fullText && (!existing.fullText || r.fullText.length > existing.fullText.length)) {
        existing.fullText = r.fullText;
      }
    }
  }
  // Sort by score descending.
  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

/** Normalize a URL for dedup: strip trailing slash, fragment, query (for some). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Only lowercase the hostname (protocol is already lowercase); preserve
    // pathname case (paths can be case-sensitive on some servers).
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/** Quality scoring: combine relevance + recency + authority signals.
 *  - relevance: provided by the search API (or 0.5 default)
 *  - recency: boost recent results (within 30 days)
 *  - authority: known domains (arxiv.org, github.com, etc.) get a boost */
export function qualityScore(
  baseRelevance: number,
  url?: string,
  publishedAt?: string
): number {
  let score = Math.max(0, Math.min(1, baseRelevance));
  // Recency boost.
  if (publishedAt) {
    const age = Date.now() - new Date(publishedAt).getTime();
    const days = age / 86_400_000;
    if (days < 30) score += 0.1;
    else if (days < 90) score += 0.05;
  }
  // Authority boost for known domains.
  if (url) {
    const domain = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
    const authorityDomains = [
      "arxiv.org", "github.com", "stackoverflow.com", "wikipedia.org",
      "nature.com", "sciencedirect.com", "ieee.org", "acm.org",
    ];
    if (authorityDomains.some((d) => domain.endsWith(d))) score += 0.1;
  }
  return Math.min(1, score);
}
