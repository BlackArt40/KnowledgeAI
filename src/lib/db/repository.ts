// ---------------------------------------------------------------------------
// Repository Pattern - async data access layer that checks isDbEnabled().
//
//   - If DB enabled -> query Prisma (PostgreSQL)
//   - Otherwise -> use the existing in-memory store (wrapped in Promise)
//
// API routes can gradually migrate to these async functions when they need
// direct DB access. The in-memory stores remain the default for reads,
// hydrated from DB on startup (see hydrate.ts) and persisted on write
// (see persist.ts).
//
// This file shows the pattern for key models. The same pattern extends to
// all models defined in the Prisma schema.
// ---------------------------------------------------------------------------

import { getDb, isDbEnabled } from "./client";
import type { PrismaUser, PrismaKb } from "./types";

// ── Users ────────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  return db.user.findUnique({ where: { email } });
}

export async function findUserById(id: string) {
  const db = await getDb();
  if (!db) return null;
  return db.user.findUnique({ where: { id } });
}

export async function listAllUsers(): Promise<PrismaUser[]> {
  const db = await getDb();
  if (!db) return [];
  return db.user.findMany({ orderBy: { createdAt: "asc" } });
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return db.user.count({});
}

// ── Knowledge Bases ──────────────────────────────────────────────────────

export async function findKbById(id: string): Promise<PrismaKb | null> {
  const db = await getDb();
  if (!db) return null;
  return db.knowledgeBase.findUnique({ where: { id } });
}

export async function listKbsByOwner(ownerId: string): Promise<PrismaKb[]> {
  const db = await getDb();
  if (!db) return [];
  return db.knowledgeBase.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listAllKbs(): Promise<PrismaKb[]> {
  const db = await getDb();
  if (!db) return [];
  return db.knowledgeBase.findMany({ orderBy: { updatedAt: "desc" } });
}

// ── Agent Tasks ──────────────────────────────────────────────────────────

export async function listAgentTasksByUser(userId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.agentTask.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// ── API Keys ─────────────────────────────────────────────────────────────

export async function findApiKeyByHash(keyHash: string) {
  const db = await getDb();
  if (!db) return null;
  return db.apiKey.findUnique({ where: { keyHash } });
}

export async function listApiKeysByUser(userId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// ── Health Check ─────────────────────────────────────────────────────────

/** Check if the database connection is healthy. */
export async function checkDbHealth(): Promise<boolean> {
  if (!isDbEnabled()) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    await db.user.count({});
    return true;
  } catch {
    return false;
  }
}
