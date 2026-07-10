// ---------------------------------------------------------------------------
// Web page fetcher - retrieves a URL and extracts readable text for indexing.
// Best-effort: strips HTML to plain text so web-link documents can be chunked
// and embedded just like uploaded text files.
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000;
const MAX_TEXT = 200_000; // cap indexed text per page
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export interface FetchedPage {
  text: string;
  title: string | null;
}

/** Fetch a URL and extract plain text + title. Returns null on any failure. */
export async function fetchUrlContent(
  url: string
): Promise<FetchedPage | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("xhtml")) return null;

    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch
      ? decodeEntities(titleMatch[1].trim()).slice(0, 120)
      : null;

    // Drop non-content blocks, then strip all tags.
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    body = body.replace(/<[^>]+>/g, " ");
    body = decodeEntities(body);
    body = body.replace(/\s+/g, " ").trim();

    if (body.length < 40) return null;
    return { text: body.slice(0, MAX_TEXT), title };
  } catch {
    return null;
  }
}
