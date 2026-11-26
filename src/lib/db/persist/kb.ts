// ---------------------------------------------------------------------------
// Persistence - write-through layer that syncs in-memory store mutations
// to PostgreSQL.
//
// Each function is a fire-and-forget async operation:
//   - If DB is enabled: writes to Prisma (errors logged, not thrown)
//   - If DB is not configured: no-op
//
// The in-memory store remains the source of truth for reads (ADR-0001). The DB
// is the recovery copy that survives restarts; multi-instance shared reads still
// need a separate evolution per that ADR.
// ---------------------------------------------------------------------------


import { getDb, isDbEnabled } from "../prisma";

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort, withFkRetry } from "./core";

export async function persistKb(kb: {
  id: string;
  name: string;
  desc: string;
  ownerId: string;
  /** D1: the owning tenant - persisted so the boundary survives a restart. */
  workspaceId?: string;
  settings: object;
  createdAt: number;
  updatedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: kb.name,
      description: kb.desc,
      ownerId: kb.ownerId,
      // D1: only write the column when the caller knows the tenant - keeps
      // pre-existing call sites (which omitted it) from resetting a row back
      // to the default workspace.
      ...(kb.workspaceId ? { workspaceId: kb.workspaceId } : {}),
      settings: kb.settings,
      updatedAt: new Date(kb.updatedAt),
    };
    await db.knowledgeBase.upsert({
      where: { id: kb.id },
      update: data,
      create: { id: kb.id, ...data, createdAt: new Date(kb.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistKb error");
  }
}

/** Delete a KB from DB. */


export async function deleteKbFromDb(kbId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.knowledgeBase.delete({ where: { id: kbId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteKbFromDb error");
  }
}

/** Prisma FK violation (P2003) - a referenced row does not exist yet. */


export async function persistDoc(doc: {
  id: string;
  kbId: string;
  name: string;
  type: string;
  size: number;
  status: string;
  progress: number;
  chunks: number;
  url?: string;
  content?: string;
  /** P4-2: view/edit/private override; undefined = inherit the KB. */
  access?: string;
  /** P3: body-edit counter + last editor. */
  version?: number;
  editedBy?: string;
  uploadedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  const data = {
    name: doc.name,
    type: doc.type,
    size: doc.size,
    status: doc.status,
    progress: doc.progress,
    chunks: doc.chunks,
    url: doc.url ?? null,
    content: doc.content ?? null,
    access: doc.access ?? null,
    version: doc.version ?? 1,
    editedBy: doc.editedBy ?? null,
    updatedAt: new Date(),
  };
  const write = () =>
    db.kbDocument.upsert({
      where: { id: doc.id },
      update: data,
      create: { id: doc.id, kbId: doc.kbId, ...data, uploadedAt: new Date(doc.uploadedAt) },
    });

  // KB creation persists fire-and-forget, and the upload path can persist the
  // document before that write commits - the FK would reject it (P2003).
  await withFkRetry(write, "[db] persistDoc error");
}

/**
 * 批量持久化文档行（整库重建这类一次性改动 N 篇的场景）。
 *
 * 逐篇 upsert 是 N 次往返；这里包成一个事务，失败整体回滚，也不会出现
 * 「前 50 篇写进去了、后 50 篇没写」的中间态。
 */


export async function persistDocs(
  docs: Array<Parameters<typeof persistDoc>[0]>
): Promise<void> {
  if (!isDbEnabled() || docs.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const row = (doc: Parameters<typeof persistDoc>[0]) => ({
    name: doc.name,
    type: doc.type,
    size: doc.size,
    status: doc.status,
    progress: doc.progress,
    chunks: doc.chunks,
    url: doc.url ?? null,
    content: doc.content ?? null,
    version: doc.version ?? 1,
    editedBy: doc.editedBy ?? null,
    updatedAt: new Date(),
  });
  // 本地 PrismaClient 类型是精简 shim，$transaction 未声明 —— 取到就用事务
  // （整批回滚，不留中间态），取不到退化为并发 upsert
  const raw = db as unknown as {
    $transaction?: (ops: Promise<unknown>[]) => Promise<unknown>;
  };
  const ops = docs.map((doc) => {
    const data = row(doc);
    return db.kbDocument.upsert({
      where: { id: doc.id },
      update: data,
      create: { id: doc.id, kbId: doc.kbId, ...data, uploadedAt: new Date(doc.uploadedAt) },
    }) as unknown as Promise<unknown>;
  });

  try {
    if (raw.$transaction) await raw.$transaction(ops);
    else await Promise.all(ops);
  } catch (err) {
    // 与本模块其他写穿函数一致：失败只记日志，不打断请求路径
    log.error({ err, count: docs.length }, "[db] persistDocs error");
  }
}


/** Delete a document from DB. */


export async function deleteDocFromDb(docId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.kbDocument.delete({ where: { id: docId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteDocFromDb error");
  }
}

/** Persist an agent task to DB. */

