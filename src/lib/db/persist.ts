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

import { getDb, isDbEnabled } from "./client";

/** Persist a user create/update to DB. */
export async function persistUser(user: {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  status: string;
  plan: string;
  createdAt: number;
  lastLoginAt: number | null;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.user.findUnique({ where: { id: user.id } });
    const data = {
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      role: user.role.toUpperCase(),
      status: user.status.toUpperCase(),
    };
    if (existing) {
      await db.user.update({ where: { id: user.id }, data });
    } else {
      await db.user.create({ data: { id: user.id, ...data } });
    }
  } catch (err) {
    console.error("[db] persistUser error:", err);
  }
}

/** Persist a KB create/update to DB. */
export async function persistKb(kb: {
  id: string;
  name: string;
  desc: string;
  ownerId: string;
  settings: object;
  createdAt: number;
  updatedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.knowledgeBase.findUnique({ where: { id: kb.id } });
    const data = {
      name: kb.name,
      description: kb.desc,
      ownerId: kb.ownerId,
      settings: kb.settings,
      updatedAt: new Date(kb.updatedAt),
    };
    if (existing) {
      await db.knowledgeBase.update({ where: { id: kb.id }, data });
    } else {
      await db.knowledgeBase.create({
        data: { id: kb.id, ...data, createdAt: new Date(kb.createdAt) },
      });
    }
  } catch (err) {
    console.error("[db] persistKb error:", err);
  }
}

/** Delete a KB from DB. */
export async function deleteKbFromDb(kbId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.knowledgeBase.delete({ where: { id: kbId } }).catch(() => {});
  } catch (err) {
    console.error("[db] deleteKbFromDb error:", err);
  }
}

/** Persist a document create/update to DB. */
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
  uploadedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.kbDocument.findUnique({ where: { id: doc.id } });
    const data = {
      name: doc.name,
      type: doc.type,
      size: doc.size,
      status: doc.status,
      progress: doc.progress,
      chunks: doc.chunks,
      url: doc.url ?? null,
      content: doc.content ?? null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.kbDocument.update({ where: { id: doc.id }, data });
    } else {
      await db.kbDocument.create({
        data: { id: doc.id, kbId: doc.kbId, ...data, uploadedAt: new Date(doc.uploadedAt) },
      });
    }
  } catch (err) {
    console.error("[db] persistDoc error:", err);
  }
}

/** Delete a document from DB. */
export async function deleteDocFromDb(docId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.kbDocument.delete({ where: { id: docId } }).catch(() => {});
  } catch (err) {
    console.error("[db] deleteDocFromDb error:", err);
  }
}

/** Persist an agent task to DB. */
export async function persistTask(task: {
  id: string;
  userId?: string;
  topic: string;
  kbId?: string;
  outputFormat: string;
  status: string;
  report?: string;
  outline: string[];
  citations: unknown[];
  steps: unknown[];
  durationMs?: number;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.agentTask.findUnique({ where: { id: task.id } });
    const data = {
      topic: task.topic,
      kbId: task.kbId ?? null,
      outputFormat: task.outputFormat,
      status: task.status,
      report: task.report ?? null,
      outline: task.outline,
      citations: task.citations,
      steps: task.steps,
      durationMs: task.durationMs ?? null,
    };
    if (existing) {
      await db.agentTask.update({ where: { id: task.id }, data });
    } else {
      await db.agentTask.create({
        data: { id: task.id, userId: task.userId, ...data, createdAt: new Date(task.createdAt) },
      });
    }
  } catch (err) {
    console.error("[db] persistTask error:", err);
  }
}

/** Persist an API key to DB. */
export async function persistApiKey(key: {
  id: string;
  userId: string;
  name: string;
  secret: string;
  prefix: string;
  scopes: string[];
  status: string;
  calls: number;
  lastUsed: number | null;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.apiKey.findUnique({ where: { id: key.id } });
    const data = {
      name: key.name,
      keyHash: key.secret,  // store the secret as keyHash in DB
      prefix: key.prefix,
      scopes: key.scopes,
      status: key.status,
      calls: key.calls,
      lastUsed: key.lastUsed ? new Date(key.lastUsed) : null,
    };
    if (existing) {
      await db.apiKey.update({ where: { id: key.id }, data });
    } else {
      await db.apiKey.create({
        data: { id: key.id, userId: key.userId, ...data, createdAt: new Date(key.createdAt) },
      });
    }
  } catch (err) {
    console.error("[db] persistApiKey error:", err);
  }
}

/** Delete an API key from DB. */
export async function deleteApiKeyFromDb(keyId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.apiKey.delete({ where: { id: keyId } }).catch(() => {});
  } catch (err) {
    console.error("[db] deleteApiKeyFromDb error:", err);
  }
}
