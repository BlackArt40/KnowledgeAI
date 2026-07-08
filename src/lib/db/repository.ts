// ---------------------------------------------------------------------------
// Repository Pattern — example showing how to swap in-memory stores for Prisma.
//
// Each in-memory store (kb, chat, agent, team, billing, apikeys, security, admin)
// can be wrapped in a repository that checks `isDbEnabled()`:
//   - If DB enabled → query Prisma
//   - Otherwise → use the existing in-memory store
//
// This file shows the pattern for the KB store as a reference.
// ---------------------------------------------------------------------------

import { getDb, isDbEnabled } from "./client";
import { listKbs as listKbsMemory, getKb as getKbMemory } from "@/lib/kb/store";
import type { KnowledgeBase } from "@/lib/kb/types";

export async function listKbs(): Promise<KnowledgeBase[]> {
  const db = await getDb();
  if (!db || !isDbEnabled()) {
    return listKbsMemory();
  }
  // Prisma query (typed via `as any` since client is dynamically imported)
  const prisma = db as {
    knowledgeBase: {
      findMany: (opts?: unknown) => Promise<unknown[]>;
    };
  };
  const rows = await prisma.knowledgeBase.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return rows as unknown as KnowledgeBase[];
}

export async function getKb(id: string): Promise<KnowledgeBase | null> {
  const db = await getDb();
  if (!db || !isDbEnabled()) {
    return getKbMemory(id) ?? null;
  }
  const prisma = db as {
    knowledgeBase: {
      findUnique: (opts: unknown) => Promise<unknown>;
    };
  };
  const row = await prisma.knowledgeBase.findUnique({ where: { id } });
  return (row as KnowledgeBase) ?? null;
}
