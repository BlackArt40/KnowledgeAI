// ---------------------------------------------------------------------------
// Hydration - loads data from PostgreSQL into in-memory stores on startup.
//
// This enables a "write-through cache" pattern:
//   - On boot: hydrate memory stores from DB (data survives restarts)
//   - On write: persist mutations to DB (see persist.ts)
//   - On read: always use fast in-memory stores (no async needed)
//
// When DB is not configured, hydration is a no-op (stores use seed data).
// ---------------------------------------------------------------------------

import { getDb, isDbEnabled } from "../prisma";
import { decryptFromString } from "@/lib/crypto";
import { hydrateSecurityState } from "@/lib/security/store";
import { markNotificationsHydrated } from "@/lib/notifications/store";
import { hydrateUserUsage, hydrateWorkspaceUsage } from "@/lib/billing/store";
import type { UsagePoint } from "@/lib/billing/types";
import type { SecurityState } from "@/lib/security/types";
import type { PrismaUser, PrismaUserSecurity, PrismaKb, PrismaDoc, PrismaAgentTask } from "../types";
import { mergeApiKeyRow, type ApiKeyRow } from "@/lib/apikeys/store";
import { hydrateInviteReservation } from "@/lib/team/invite-seats";
import { log } from "@/lib/obs/log";
import {
  createEmptyAdminStore,
  createEmptyAgentStore,
  createEmptyApiKeyStore,
  createEmptyAuthStore,
  createEmptyBillingStore,
  createEmptyChatStore,
  createEmptyKbStore,
  createEmptyKgStore,
  createEmptyModelStore,
  createEmptyNotificationStore,
  createEmptySecurityStore,
  createEmptyTeamStore,
  createEmptyWebhookStore,
  createEmptyWorkspaceStore,
} from "../store-factories";

// P1-9: coalesce concurrent first-request calls (the proxy fires
// ensureHydrated() fire-and-forget on every request) into a single in-flight
// hydration promise - the old code ran hydrateFromDb() N times in parallel,
// duplicating rows in the in-memory stores. Reset on settle so a FAILED
// hydration (see P1-10) retries on the next request.

/** Whether hydration has been completed. */
export async function hydrateSecurityStates(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.userSecurity.findMany({});
  for (const row of rows) hydrateSecurityRow(row);
  return rows.length;
}

/** Decrypt a stored secret. A rotated AUTH_SECRET must not silently disable
 *  2FA - we return null instead of throwing, and `enabled` stays true. */

export function hydrateSecurityRow(row: PrismaUserSecurity): void {
  const tf = (row.twoFactor ?? {}) as Record<string, unknown>;
  const backupCodes = Array.isArray(tf.backupCodes)
    ? tf.backupCodes.filter((c): c is string => typeof c === "string")
    : [];
  const pendingBackupCodes = Array.isArray(tf.pendingBackupCodes)
    ? tf.pendingBackupCodes.filter((c): c is string => typeof c === "string")
    : [];
  const privacy = (row.privacy ?? {}) as Record<string, unknown>;
  const method = tf.method === "app" || tf.method === "sms" ? tf.method : null;
  hydrateSecurityState(row.userId, {
    twoFactor: {
      enabled: tf.enabled === true,
      method,
      secret: decryptOrNull(tf.secret),
      backupCodes,
      backupCodesRemaining: backupCodes.length,
      enrolledAt: typeof tf.enrolledAt === "number" ? tf.enrolledAt : null,
      pendingSecret: decryptOrNull(tf.pendingSecret),
      pendingBackupCodes,
      lastUsedStep: typeof tf.lastUsedStep === "number" ? tf.lastUsedStep : null,
    },
    sessions: Array.isArray(row.sessions) ? (row.sessions as SecurityState["sessions"]) : [],
    loginHistory: Array.isArray(row.loginHistory)
      ? (row.loginHistory as SecurityState["loginHistory"])
      : [],
    privacy: {
      analytics: privacy.analytics !== false,
      crashReports: privacy.crashReports !== false,
      trainingOptIn: privacy.trainingOptIn === true,
      dataRetentionDays: typeof privacy.dataRetentionDays === "number" ? privacy.dataRetentionDays : 90,
    },
  });
}


export function decryptOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return decryptFromString(value);
  } catch {
    return null;
  }
}


export function hydrateUser(u: PrismaUser): void {
  const g = globalThis as unknown as { __KAI_USER_STORE__?: { users: Map<string, unknown>; emailIndex: Map<string, string>; seeded: boolean } };
  if (!g.__KAI_USER_STORE__) return;
  const store = g.__KAI_USER_STORE__;
  const user = {
    id: u.id,
    email: u.email,
    name: u.name,
    passwordHash: u.passwordHash || "",
    role: u.role.toLowerCase(),
    // M-1: restore the persisted plan tier (was hardcoded "free", silently
    // downgrading paid users after every restart).
    plan: ((u as unknown as { plan?: string | null }).plan || "free").toLowerCase(),
    status: u.status.toLowerCase(),
    createdAt: u.createdAt.getTime(),
    lastLoginAt: (u as unknown as { lastLoginAt?: Date | null }).lastLoginAt?.getTime() ?? null,
    // P5-4: UI language preference.
    locale: (u as unknown as { locale?: string | null }).locale ?? "zh-CN",
    // P3-2: OAuth provider links (provider -> providerAccountId).
    oauthLinks: (u as unknown as { oauthLinks?: Record<string, string> | null }).oauthLinks ?? undefined,
    // P8: password reset state (hash + expiry). Absent on legacy rows.
    passwordResetTokenHash:
      (u as unknown as { passwordResetTokenHash?: string | null }).passwordResetTokenHash ?? undefined,
    passwordResetExpires: (() => {
      const e = (u as unknown as { passwordResetExpires?: Date | null }).passwordResetExpires;
      return e ? e.getTime() : undefined;
    })(),
    // P8: email verification state. Absent on legacy rows.
    emailVerifiedAt: (() => {
      const e = (u as unknown as { emailVerifiedAt?: Date | null }).emailVerifiedAt;
      return e ? e.getTime() : undefined;
    })(),
    verificationTokenHash:
      (u as unknown as { verificationTokenHash?: string | null }).verificationTokenHash ?? undefined,
    verificationExpires: (() => {
      const e = (u as unknown as { verificationExpires?: Date | null }).verificationExpires;
      return e ? e.getTime() : undefined;
    })(),
  };
  store.users.set(u.id, user);
  store.emailIndex.set(u.email.toLowerCase(), u.id);
}


export function hydrateKb(kb: PrismaKb): void {
  const g = globalThis as unknown as { __KAI_KB_STORE__?: { kbs: Map<string, unknown>; docs: Map<string, unknown>; seeded: boolean } };
  if (!g.__KAI_KB_STORE__) return;
  const settings = (kb.settings as Record<string, number>) ?? {};
  g.__KAI_KB_STORE__.kbs.set(kb.id, {
    id: kb.id,
    name: kb.name,
    desc: kb.description ?? "",
    color: "from-primary/15",
    initial: kb.name.charAt(0) || "K",
    ownerId: kb.ownerId,
    // D1 (engineering-assurance 2026-09-30): read the real column. This used to
    // hard-code "ws_default" because the field was memory-only, which silently
    // merged every other tenant's KB into the default workspace on restart.
    // Rows written before the column existed default to "ws_default" in SQL,
    // so the fallback only covers a genuinely absent value.
    workspaceId: (kb as unknown as { workspaceId?: string | null }).workspaceId || "ws_default",
    createdAt: kb.createdAt.getTime(),
    updatedAt: kb.updatedAt.getTime(),
    settings: {
      chunkSize: settings.chunkSize ?? 500,
      chunkOverlap: settings.chunkOverlap ?? 50,
      embeddingModel: settings.embeddingModel ?? "text-embedding-3-small",
      topK: settings.topK ?? 5,
    },
  });
}


export function hydrateDoc(d: PrismaDoc): void {
  const g = globalThis as unknown as { __KAI_KB_STORE__?: { kbs: Map<string, unknown>; docs: Map<string, unknown>; seeded: boolean } };
  if (!g.__KAI_KB_STORE__) return;
  g.__KAI_KB_STORE__.docs.set(d.id, {
    id: d.id,
    kbId: d.kbId,
    name: d.name,
    type: d.type,
    size: d.size,
    status: d.status,
    progress: d.progress,
    chunks: d.chunks,
    url: d.url ?? undefined,
    content: d.content ?? undefined,
    // P4-2: only the three known levels are legal; anything else inherits.
    access:
      d.access === "view" || d.access === "edit" || d.access === "private"
        ? d.access
        : undefined,
    // P3: optimistic-concurrency counter + last editor (older rows default to 1).
    version: (d as unknown as { version?: number }).version ?? 1,
    editedBy: (d as unknown as { editedBy?: string | null }).editedBy ?? undefined,
    updatedAt: (d as unknown as { updatedAt?: Date }).updatedAt?.getTime(),
    uploadedAt: d.uploadedAt.getTime(),
  });
}


export function hydrateTask(t: PrismaAgentTask): void {
  const g = globalThis as unknown as { __KAI_AGENT_STORE__?: { tasks: Map<string, unknown> } };
  if (!g.__KAI_AGENT_STORE__) return;
  const row = t as unknown as {
    workspaceId?: string | null;
    kbName?: string | null;
    agents?: unknown[] | null;
    maxSteps?: number | null;
    template?: string | null;
    updatedAt?: Date | null;
  };
  g.__KAI_AGENT_STORE__.tasks.set(t.id, {
    id: t.id,
    topic: t.topic,
    kbId: t.kbId ?? undefined,
    kbName: row.kbName ?? undefined,
    // P4-3: persisted column since the agent_task_extended migration - the
    // default keeps rows written before the migration in the right tenant.
    workspaceId: row.workspaceId ?? "ws_default",
    outputFormat: t.outputFormat,
    // P2-1: workflow config persisted so the separate worker process can run
    // tasks created by the web process (cross-process consistency).
    agents: (row.agents as string[] | null) ?? ["planner", "searcher", "analyzer", "writer"],
    maxSteps: row.maxSteps ?? 5,
    template: row.template ?? undefined,
    status: t.status,
    report: t.report ?? undefined,
    outline: t.outline as string[] ?? [],
    citations: t.citations as unknown[] ?? [],
    steps: t.steps as unknown[] ?? [],
    durationMs: t.durationMs ?? undefined,
    shareConfig: (t.shareConfig as Record<string, unknown> | null) ?? undefined,
    versions: (t.versions as unknown[] | null) ?? undefined,
    comments: (t.comments as unknown[] | null) ?? undefined,
    createdAt: t.createdAt.getTime(),
    updatedAt: (row.updatedAt ?? t.createdAt).getTime(),
    userId: t.userId,
  });
}

/** Ensure hydration has run. Call from API route middleware.
 *  P1-9: concurrent callers share one in-flight hydration; a failed run
 *  clears the memo so the next request retries (P1-10). */
