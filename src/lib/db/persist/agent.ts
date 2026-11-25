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

export async function persistTask(task: {
  id: string;
  userId?: string;
  topic: string;
  kbId?: string;
  kbName?: string;
  outputFormat: string;
  status: string;
  report?: string;
  outline: string[];
  citations: unknown[];
  steps: unknown[];
  durationMs?: number;
  createdAt: number;
  shareConfig?: unknown;
  versions?: unknown;
  comments?: unknown;
  agents?: unknown[];
  maxSteps?: number;
  template?: string;
  workspaceId?: string;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      topic: task.topic,
      kbId: task.kbId ?? null,
      kbName: task.kbName ?? null,
      outputFormat: task.outputFormat,
      status: task.status,
      report: task.report ?? null,
      outline: task.outline,
      citations: task.citations,
      steps: task.steps,
      durationMs: task.durationMs ?? null,
      shareConfig: task.shareConfig ?? null,
      versions: task.versions ?? null,
      comments: task.comments ?? null,
      agents: task.agents ?? null,
      maxSteps: task.maxSteps ?? 5,
      template: task.template ?? null,
      workspaceId: task.workspaceId ?? "ws_default",
    };
    await db.agentTask.upsert({
      where: { id: task.id },
      update: data,
      create: { id: task.id, userId: task.userId, ...data, createdAt: new Date(task.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistTask error");
  }
}

/** M-8: delete an agent task row (deleteTask() used to only drop the
 *  in-memory entry, so deleted tasks resurrected after a restart). */


export async function deleteAgentTaskFromDb(taskId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.agentTask.delete({ where: { id: taskId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteAgentTaskFromDb error");
  }
}

/** Delete all tasks for a user (account deletion). */


export async function deleteAgentTasksByUserFromDb(userId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { agentTask: { deleteMany: (o: unknown) => Promise<unknown> } })
      .agentTask.deleteMany({ where: { userId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteAgentTasksByUserFromDb error");
  }
}

/** Persist an API key to DB. */

