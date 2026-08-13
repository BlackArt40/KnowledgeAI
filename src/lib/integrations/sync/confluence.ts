// ---------------------------------------------------------------------------
// Confluence sync connector (P7-2) - import a space's pages into a knowledge
// base via the Confluence Cloud REST API.
//
// Env-gated: CONFLUENCE_BASE_URL + CONFLUENCE_EMAIL + CONFLUENCE_TOKEN
// (API token / PAT, Basic auth). CONFLUENCE_API_URL overrides the API root
// (acceptance tests point it at a local mock).
//
// body.storage HTML is converted to Markdown (headings/lists/tables/code/
// links - a pragmatic subset) so pages index like regular documents.
// ---------------------------------------------------------------------------

import { log } from "@/lib/obs/log";

export const MAX_PAGES = 20;

export function confluenceApiBase(): string {
  return process.env.CONFLUENCE_API_URL || process.env.CONFLUENCE_BASE_URL || "";
}

export function isConfluenceConfigured(): boolean {
  return !!process.env.CONFLUENCE_BASE_URL && !!process.env.CONFLUENCE_EMAIL && !!process.env.CONFLUENCE_TOKEN;
}

function confluenceAuthHeader(): string {
  const email = process.env.CONFLUENCE_EMAIL ?? "";
  const token = process.env.CONFLUENCE_TOKEN ?? "";
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

// ── HTML -> Markdown (Confluence storage format subset) ───────────────────

/** Inline HTML -> markdown (emphasis / code / links), then strip remaining
 *  tags and decode entities. Newlines are preserved (block structure comes
 *  from the caller). */
function formatInline(s: string): string {
  return s
    .replace(/<strong(?:\s[^>]*)?>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b(?:\s[^>]*)?>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em(?:\s[^>]*)?>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i(?:\s[^>]*)?>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<a(?:\s[^>]*?href="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) =>
      href ? `[${text}](${href})` : text
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Inline conversion for table cells (single-line content, whitespace
 *  collapsed). */
function inlineHtmlToMd(s: string): string {
  return formatInline(s).replace(/\s+/g, " ").trim();
}

/** Minimal HTML-to-Markdown converter for Confluence `body.storage` markup.
 *  Handles headings / paragraphs / lists / tables / code / links / emphasis;
 *  ac:structured-macro wrappers are unwrapped (inner HTML is converted). */
export function htmlToMarkdown(html: string): string {
  // Unwrap Atlassian macros (ac:structured-macro, ac:rich-text-body, etc.)
  let body = html
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, (m) => {
      // Keep the inner rich-text body if present, else drop the macro.
      const inner = m.match(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i);
      return inner ? inner[1] : "";
    })
    .replace(/<\/?(ac:|ri:|at:)[^>]*>/gi, "");

  // Tables -> pipe rows (dedicated pass so cell content is inline-converted
  // before block stripping; header separator row added after the first row).
  body = body.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
      const cells = [...m[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((c) =>
        inlineHtmlToMd(c[1])
      );
      return `| ${cells.join(" | ")} |`;
    });
    if (rows.length === 0) return "";
    const cols = rows[0].split("|").length - 2;
    const sep = `| ${Array(Math.max(cols, 1)).fill("---").join(" | ")} |`;
    return `\n${rows[0]}\n${sep}\n${rows.slice(1).join("\n")}\n`;
  });

  // Headings (before block breaks so the opening tag is still present)
  for (const [tag, prefix] of [
    ["h1", "# "],
    ["h2", "## "],
    ["h3", "### "],
    ["h4", "#### "],
    ["h5", "##### "],
    ["h6", "###### "],
  ] as const) {
    body = body.replace(new RegExp(`<${tag}[^>]*>`, "gi"), `\n${prefix}`);
    body = body.replace(new RegExp(`</${tag}>`, "gi"), "\n");
  }

  // Block breaks (li handled first so the generic open-tag pass below does
  // not consume it before the "- " prefix is applied)
  body = body.replace(/<li(?:\s[^>]*)?>/gi, "\n- ");
  body = body.replace(/<\/(p|div|blockquote|pre)>/gi, "\n");
  body = body.replace(/<(p|div|blockquote|pre)(?:\s[^>]*)?>/gi, "\n");
  body = body.replace(/<\/li>/gi, "");
  body = body.replace(/<br\s*\/?>/gi, "\n");
  body = body.replace(/<hr\s*\/?>/gi, "\n---\n");
  body = body.replace(/<ul[^>]*>|<\/ul>/gi, "").replace(/<ol[^>]*>|<\/ol>/gi, "");

  // Inline formatting + tag strip + entity decode (newlines preserved)
  body = formatInline(body);
  // Normalize: collapse spaces within lines, keep one blank line between
  // blocks.
  body = body.replace(/[ \t]+/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return body;
}

// ── API client ────────────────────────────────────────────────────────────

interface ConfluencePage {
  id: string;
  title: string;
  body?: { storage?: { value?: string } };
}

async function confluenceFetch(path: string): Promise<unknown> {
  const base = confluenceApiBase();
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: confluenceAuthHeader(), Accept: "application/json" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.warn({ status: res.status, detail: detail.slice(0, 300) }, "[sync] confluence request failed");
    throw new Error(`Confluence API ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/** Fetch a Confluence space's pages (title + markdown body). */
export async function fetchConfluenceSpace(
  spaceKey: string
): Promise<{ id: string; title: string; markdown: string }[]> {
  const data = (await confluenceFetch(
    `/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&limit=${MAX_PAGES}&expand=body.storage`
  )) as { results?: ConfluencePage[] };

  return (data.results ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    markdown: htmlToMarkdown(p.body?.storage?.value ?? ""),
  }));
}
