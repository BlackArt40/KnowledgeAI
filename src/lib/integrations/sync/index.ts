// ---------------------------------------------------------------------------
// P7-2 sync entry - import external documents (Notion database pages /
// Confluence space pages) into a knowledge base.
//
// Each page becomes a KB document via addDocument() (which enqueues the
// doc-process pipeline: parse -> chunk -> index), deduplicated by name
// (already-imported pages are skipped). Audited as `integration.sync`.
// ---------------------------------------------------------------------------

import { addDocument, listDocuments } from "@/lib/kb/store";
import type { KnowledgeBase } from "@/lib/kb/types";
import type { RequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
import { log } from "@/lib/obs/log";
import { fetchNotionDatabase, notionToken } from "./notion";
import { fetchConfluenceSpace } from "./confluence";

export interface SyncResult {
  imported: number;
  skipped: number;
  failed: number;
  docs: { name: string; status: "imported" | "skipped" | "failed"; error?: string }[];
}

async function importPage(
  kb: KnowledgeBase,
  page: { id: string; title: string; markdown: string }
): Promise<SyncResult["docs"][number]> {
  const name = page.title.trim() || `未命名页面 ${page.id.slice(0, 8)}`;
  if (!page.markdown.trim()) {
    return { name, status: "skipped", error: "空内容" };
  }
  // Dedupe by document name - re-syncs are idempotent.
  const exists = listDocuments(kb.id).some((d) => d.name === name);
  if (exists) return { name, status: "skipped" };
  try {
    addDocument({ kbId: kb.id, name, size: page.markdown.length, content: page.markdown });
    return { name, status: "imported" };
  } catch (err) {
    log.warn({ err, name }, "[sync] import failed");
    return { name, status: "failed", error: err instanceof Error ? err.message : "导入失败" };
  }
}

function tally(docs: SyncResult["docs"]): Omit<SyncResult, "docs"> {
  return {
    imported: docs.filter((d) => d.status === "imported").length,
    skipped: docs.filter((d) => d.status === "skipped").length,
    failed: docs.filter((d) => d.status === "failed").length,
  };
}

/** Import pages from a Notion database into a KB.
 *  Token resolution: body-provided token wins, else NOTION_TOKEN env. */
export async function syncNotionToKb(
  user: RequestUser,
  kb: KnowledgeBase,
  input: { databaseId: string; token?: string }
): Promise<SyncResult> {
  const token = input.token?.trim() || notionToken();
  if (!token) throw new Error("未配置 Notion Token（NOTION_TOKEN 或请求体 token）");

  const pages = await fetchNotionDatabase(input.databaseId.trim(), token);
  const docs: SyncResult["docs"] = [];
  for (const page of pages) docs.push(await importPage(kb, page));

  recordAudit({
    actorId: user.id,
    actor: user.name,
    action: "integration.sync",
    target: "notion",
    detail: `数据库 ${input.databaseId} → 知识库「${kb.name}」：导入 ${docs.filter((d) => d.status === "imported").length} / 跳过 ${docs.filter((d) => d.status === "skipped").length} / 失败 ${docs.filter((d) => d.status === "failed").length}`,
  });
  log.info({ kbId: kb.id, pages: pages.length }, "[sync] notion sync finished");
  return { docs, ...tally(docs) };
}

/** Import pages from a Confluence space into a KB. */
export async function syncConfluenceToKb(
  user: RequestUser,
  kb: KnowledgeBase,
  input: { spaceKey: string }
): Promise<SyncResult> {
  const pages = await fetchConfluenceSpace(input.spaceKey.trim());
  const docs: SyncResult["docs"] = [];
  for (const page of pages) docs.push(await importPage(kb, page));

  recordAudit({
    actorId: user.id,
    actor: user.name,
    action: "integration.sync",
    target: "confluence",
    detail: `空间 ${input.spaceKey} → 知识库「${kb.name}」：导入 ${docs.filter((d) => d.status === "imported").length} / 跳过 ${docs.filter((d) => d.status === "skipped").length} / 失败 ${docs.filter((d) => d.status === "failed").length}`,
  });
  log.info({ kbId: kb.id, pages: pages.length }, "[sync] confluence sync finished");
  return { docs, ...tally(docs) };
}
