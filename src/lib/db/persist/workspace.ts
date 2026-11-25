// ---------------------------------------------------------------------------
// Persistence - write-through layer that syncs in-memory store mutations
// to PostgreSQL.
//
// Each function is a fire-and-forget async operation:
//   - If DB is enabled: writes to Prisma (errors logged, not thrown)
//   - If DB is not configured: no-op
//
// The in-memory store remains the source of truth for reads. The DB is the
// persistence layer that survives restarts and enables multi-instance in
// future iterations (when stores are migrated to read directly from DB).
// ---------------------------------------------------------------------------


import { getDb, isDbEnabled } from "../prisma";

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort } from "./core";

export async function persistWorkspace(ws: {
  id: string;
  name: string;
  plan: string;
  ownerId: string;
  brandColor: string;
  /** D2: member emails - persisted so membership survives a restart. */
  members?: string[];
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: ws.name,
      plan: ws.plan,
      ownerId: ws.ownerId,
      brandColor: ws.brandColor,
      ...(ws.members ? { members: ws.members } : {}),
      updatedAt: new Date(),
    };
    await db.workspace.upsert({
      where: { id: ws.id },
      update: data,
      create: { id: ws.id, ...data, createdAt: new Date(ws.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistWorkspace error");
  }
}

/** Delete a workspace row (管理员删号 / 清理测试租户).
 *
 *  先清 KbChunk（向量表无 FK，会残留），再删工作区；KB/文档/会话/任务都通过
 *  workspaceId 级联或上游路由已删除，这里只兜底 workspace 本身。
 *  fire-and-forget：失败只记日志，内存态已经删掉。 */


export async function deleteWorkspaceFromDb(workspaceId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const raw = db as unknown as {
      $executeRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<unknown>;
    };
    const exec = (sql: string, ...params: unknown[]) =>
      raw.$executeRawUnsafe?.(sql, ...params)?.catch((err: unknown) => bestEffort(err)) ?? Promise.resolve();
    // KbChunk 没有指向 Workspace 的 FK，删租户前先按 KB 清掉向量行
    await exec(
      'DELETE FROM kb_chunks WHERE kb_id IN (SELECT id FROM "KnowledgeBase" WHERE "workspaceId" = $1)',
      workspaceId
    );
    await exec('DELETE FROM "Workspace" WHERE id = $1', workspaceId);
  } catch (err) {
    log.error({ err }, "[db] deleteWorkspaceFromDb error");
  }
}

/** Append an audit log entry. */

