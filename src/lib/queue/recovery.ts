// ---------------------------------------------------------------------------
// Queue recovery (P1) - MemoryQueue has no persistence: a process restart
// loses every queued/active job, leaving DB rows stuck in queued/processing
// forever. On boot, re-enqueue those rows. BullMQ owns its own job state and
// handles stalled jobs, so this is a no-op when REDIS_URL is configured.
// ---------------------------------------------------------------------------

import { getDb, isDbEnabled } from "@/lib/db/client";
import { enqueue, isQueueExternal } from "./index";
import { log } from "@/lib/obs/log";

export async function recoverInterruptedJobs(): Promise<number> {
  if (isQueueExternal() || !isDbEnabled()) return 0;
  const db = await getDb();
  if (!db) return 0;

  let recovered = 0;
  try {
    const docs = await db.kbDocument.findMany({
      where: { status: { in: ["queued", "processing"] } },
    });
    for (const doc of docs) {
      try {
        await enqueue("doc-process", { docId: doc.id });
        recovered++;
      } catch (err) {
        log.warn({ err, docId: doc.id }, "[queue] failed to re-enqueue interrupted document");
      }
    }

    const tasks = await db.agentTask.findMany({
      where: { status: { in: ["queued", "running"] } },
    });
    for (const task of tasks) {
      try {
        await enqueue("agent-run", { taskId: task.id, userId: task.userId });
        recovered++;
      } catch (err) {
        log.warn({ err, taskId: task.id }, "[queue] failed to re-enqueue interrupted agent task");
      }
    }
  } catch (err) {
    log.error({ err }, "[queue] recovery scan failed");
    return recovered;
  }

  if (recovered > 0) log.info({ recovered }, "[queue] re-enqueued interrupted jobs");
  return recovered;
}
