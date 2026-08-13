// ---------------------------------------------------------------------------
// Notion sync connector (P7-2) - import database pages into a knowledge base.
//
// Talks to the Notion API v1 (env-gated: NOTION_TOKEN; endpoint override
// NOTION_API_URL for acceptance tests / proxies). Blocks are converted to
// Markdown so imported pages index like any other text document.
//
// Notion API reference (subset used):
//   POST /v1/databases/{id}/query      -> pages (page_size 20)
//   GET  /v1/blocks/{id}/children      -> block tree (recursive, 2 levels)
// ---------------------------------------------------------------------------

import { log } from "@/lib/obs/log";

export const NOTION_VERSION = "2022-06-28";
export const MAX_PAGES = 20;
export const MAX_BLOCK_DEPTH = 2;

export function notionApiBase(): string {
  return process.env.NOTION_API_URL || "https://api.notion.com";
}

export function notionToken(): string | undefined {
  return process.env.NOTION_TOKEN || undefined;
}

export function isNotionConfigured(): boolean {
  return !!notionToken();
}

// ── Block -> Markdown conversion ──────────────────────────────────────────

interface NotionRichText {
  plain_text?: string;
  href?: string | null;
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean };
}
interface NotionBlock {
  type: string;
  has_children?: boolean;
  paragraph?: { rich_text?: NotionRichText[] };
  heading_1?: { rich_text?: NotionRichText[] };
  heading_2?: { rich_text?: NotionRichText[] };
  heading_3?: { rich_text?: NotionRichText[] };
  bulleted_list_item?: { rich_text?: NotionRichText[] };
  numbered_list_item?: { rich_text?: NotionRichText[] };
  to_do?: { rich_text?: NotionRichText[]; checked?: boolean };
  toggle?: { rich_text?: NotionRichText[] };
  quote?: { rich_text?: NotionRichText[] };
  code?: { rich_text?: NotionRichText[]; language?: string };
  callout?: { rich_text?: NotionRichText[] };
  divider?: Record<string, never>;
  table?: { table_width?: number; has_column_header?: boolean; children?: NotionBlock[] };
  table_row?: { cells?: NotionRichText[][] };
  image?: { caption?: NotionRichText[] };
  child_page?: { title?: string };
  /** Nested children when embedded at the block top level (some API shapes). */
  children?: NotionBlock[];
  [key: string]: unknown;
}

function richToMarkdown(rich: NotionRichText[] | undefined): string {
  if (!rich) return "";
  return rich
    .map((r) => {
      let text = r.plain_text ?? "";
      if (r.annotations?.code) text = `\`${text}\``;
      if (r.annotations?.bold) text = `**${text}**`;
      if (r.annotations?.italic) text = `*${text}*`;
      if (r.annotations?.strikethrough) text = `~~${text}~~`;
      return r.href ? `[${text}](${r.href})` : text;
    })
    .join("");
}

/** Convert a Notion block tree to Markdown (recursive, depth-capped). */
export function blocksToMarkdown(blocks: NotionBlock[], depth = 0): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
        lines.push(richToMarkdown(b.paragraph?.rich_text));
        break;
      case "heading_1":
        lines.push(`# ${richToMarkdown(b.heading_1?.rich_text)}`);
        break;
      case "heading_2":
        lines.push(`## ${richToMarkdown(b.heading_2?.rich_text)}`);
        break;
      case "heading_3":
        lines.push(`### ${richToMarkdown(b.heading_3?.rich_text)}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${richToMarkdown(b.bulleted_list_item?.rich_text)}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${richToMarkdown(b.numbered_list_item?.rich_text)}`);
        break;
      case "to_do":
        lines.push(`- [${b.to_do?.checked ? "x" : " "}] ${richToMarkdown(b.to_do?.rich_text)}`);
        break;
      case "toggle":
        lines.push(`> ${richToMarkdown(b.toggle?.rich_text)}`);
        break;
      case "quote":
        lines.push(`> ${richToMarkdown(b.quote?.rich_text)}`);
        break;
      case "code":
        lines.push(`\`\`\`${b.code?.language ?? ""}\n${richToMarkdown(b.code?.rich_text)}\n\`\`\``);
        break;
      case "callout":
        lines.push(`> 💡 ${richToMarkdown(b.callout?.rich_text)}`);
        break;
      case "divider":
        lines.push("---");
        break;
      case "table": {
        const rows = (b.table?.children ?? []).map((r) =>
          (r.table_row?.cells ?? []).map((c) => richToMarkdown(c).replace(/\|/g, "\\|"))
        );
        if (rows.length > 0) {
          lines.push(
            rows.map((r) => `| ${r.join(" | ")} |`).join("\n"),
            `| ${rows[0].map(() => "---").join(" | ")} |`
          );
        }
        break;
      }
      case "image":
        lines.push(`*图片：${richToMarkdown(b.image?.caption)}*`);
        break;
      case "child_page":
        lines.push(`## 子页面：${b.child_page?.title ?? ""}`);
        break;
      default:
        // Unknown block types: skip silently (Notion adds types over time).
        break;
    }
    // Nested children (list items, toggles, tables, ...). Notion embeds them
    // either inside the type object ({type, toggle:{children}}) or at the
    // block top level ({type, children}) depending on the API call shape.
    const typeObj = b[b.type as keyof NotionBlock] as { children?: NotionBlock[] } | undefined;
    const childBlocks: NotionBlock[] | undefined = b.children ?? typeObj?.children;
    if (childBlocks && depth < MAX_BLOCK_DEPTH) {
      const childMd = blocksToMarkdown(childBlocks, depth + 1);
      if (childMd) lines.push(childMd.split("\n").map((l) => `  ${l}`).join("\n"));
    }
  }
  return lines.filter((l) => l !== "").join("\n");
}

// ── API client ────────────────────────────────────────────────────────────

interface NotionPage {
  id: string;
  properties?: Record<string, { title?: { plain_text?: string }[]; [k: string]: unknown }>;
}

async function notionFetch(
  path: string,
  token: string,
  init?: RequestInit
): Promise<unknown> {
  const res = await fetch(`${notionApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.warn({ status: res.status, detail: detail.slice(0, 300) }, "[sync] notion request failed");
    throw new Error(`Notion API ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

function titleOf(page: NotionPage): string {
  const props = page.properties ?? {};
  for (const v of Object.values(props)) {
    const title = v?.title;
    if (Array.isArray(title)) {
      const text = title.map((t) => t.plain_text ?? "").join("").trim();
      if (text) return text;
    }
  }
  return page.id;
}

/** Fetch a Notion database's pages (title + markdown body). */
export async function fetchNotionDatabase(
  databaseId: string,
  token: string
): Promise<{ id: string; title: string; markdown: string }[]> {
  const query = (await notionFetch(`/v1/databases/${databaseId}/query`, token, {
    method: "POST",
    body: JSON.stringify({ page_size: MAX_PAGES }),
  })) as { results?: NotionPage[] };

  const pages: { id: string; title: string; markdown: string }[] = [];
  for (const page of query.results ?? []) {
    const blocks = (await notionFetch(`/v1/blocks/${page.id}/children`, token)) as {
      results?: NotionBlock[];
    };
    pages.push({
      id: page.id,
      title: titleOf(page),
      markdown: blocksToMarkdown(blocks.results ?? []),
    });
  }
  return pages;
}
