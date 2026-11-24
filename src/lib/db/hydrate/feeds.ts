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
import type { UsagePoint } from "@kai/shared/billing/types";
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
export async function hydrateConversations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const convs = await (db as unknown as {
      conversation: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const g = globalThis as unknown as { __KAI_CHAT_STORE__?: { conversations: Map<string, unknown> } };
    if (!g.__KAI_CHAT_STORE__) return 0;
    for (const c of convs as unknown as { id: string; kbId: string; userId: string; title: string; createdAt: Date; updatedAt: Date; shared: boolean; workspaceId: string; archived: boolean; tags: string[] }[]) {
      // Load messages for this conversation
      const msgs = await (db as unknown as {
        message: { findMany: (o: unknown) => Promise<unknown[]> };
      }).message.findMany({
        where: { conversationId: c.id },
        orderBy: { createdAt: "asc" },
      });
      g.__KAI_CHAT_STORE__.conversations.set(c.id, {
        id: c.id,
        kbId: c.kbId,
        title: c.title,
        userId: c.userId,
        createdAt: c.createdAt.getTime(),
        updatedAt: c.updatedAt.getTime(),
        // P5-3: hydrate the persisted P4-1/P4-3 fields (shared/workspaceId
        // used to be memory-only and were lost on restart) + archived/tags.
        shared: c.shared ?? undefined,
        workspaceId: c.workspaceId ?? "ws_default",
        archived: c.archived ?? undefined,
        tags: c.tags ?? undefined,
        messages: (msgs as unknown as { id: string; role: string; content: string; citations: unknown; createdAt: Date; feedback: string | null; feedbackNote: string | null; feedbackAt: Date | null }[]).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          createdAt: m.createdAt.getTime(),
          feedback: m.feedback ?? undefined,
          feedbackNote: m.feedbackNote ?? undefined,
          feedbackAt: m.feedbackAt ? m.feedbackAt.getTime() : undefined,
        })),
      });
    }
    return convs.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateConversations error");
    throw err;
  }
}

/** Hydrate model configs from DB. The store is Map<userId, Map<id, ModelConfig>>. */

export async function hydrateModelConfigs(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const configs = await (db as unknown as {
      modelConfig: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).modelConfig.findMany({});
    const g = globalThis as unknown as { __KAI_MODEL_STORE__?: Map<string, Map<string, unknown>> };
    if (!g.__KAI_MODEL_STORE__) return 0;
    const store = g.__KAI_MODEL_STORE__;
    let count = 0;
    for (const c of configs as unknown as { id: string; userId: string; name: string; provider: string; providerName: string; apiKey: string; baseUrl: string; chatModel: string; embeddingModel: string; enabled: boolean; isDefault: boolean; lastTestedAt: Date | null; lastTestOk: boolean | null; createdAt: Date }[]) {
      let inner = store.get(c.userId);
      if (!inner) {
        inner = new Map();
        store.set(c.userId, inner);
      }
      inner.set(c.id, {
        id: c.id,
        userId: c.userId,
        name: c.name,
        provider: c.provider,
        providerName: c.providerName,
        // P3-4: model keys are stored encrypted in the DB (persistModelConfig);
        // decrypt back to plaintext in memory. Legacy plaintext rows pass
        // through unchanged via decryptFromString's plaintext fallback.
        apiKey: decryptFromString(c.apiKey),
        baseUrl: c.baseUrl,
        chatModel: c.chatModel,
        embeddingModel: c.embeddingModel,
        enabled: c.enabled,
        isDefault: c.isDefault,
        lastTestedAt: c.lastTestedAt?.getTime() ?? null,
        lastTestOk: c.lastTestOk,
        createdAt: c.createdAt.getTime(),
      });
      count++;
    }
    return count;
  } catch (err) {
    log.error({ err }, "[db] hydrateModelConfigs error");
    throw err;
  }
}

/** Hydrate the P3-4 security audit trail (newest first, chain verified). */

export async function hydrateAudit(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const rows = await (db as unknown as {
      securityAudit: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).securityAudit.findMany({ orderBy: { createdAt: "desc" } });
    const events = (rows as unknown as {
      id: string; actorId: string | null; actor: string; action: string;
      target: string; detail: string; ip: string | null;
      prevHash: string; hash: string; createdAt: Date;
    }[]).map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: r.detail,
      ip: r.ip,
      prevHash: r.prevHash,
      hash: r.hash,
      createdAt: r.createdAt.getTime(),
    }));
    // Seed the audit store directly (globalThis pattern, same as the other
    // hydrators) - this keeps db/ free of store-module imports. Chain
    // integrity is verified per-query by GET /api/admin/audit.
    const g = globalThis as unknown as { __KAI_AUDIT_STORE__?: unknown[] };
    g.__KAI_AUDIT_STORE__ = events as unknown[];
    return events.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateAudit error");
    throw err;
  }
}

/** Hydrate notifications from DB. */

export async function hydrateNotifications(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const d = db as unknown as {
      notification: { findMany: (o?: unknown) => Promise<unknown[]> };
      notificationPrefs: { findMany: (o?: unknown) => Promise<unknown[]> };
    };
    const notifs = await d.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const prefs = await d.notificationPrefs.findMany({});
    const g = globalThis as unknown as {
      __KAI_NOTIF_STORE__?: {
        notificationsByUser: Map<string, unknown[]>;
        prefsByUser?: Map<string, unknown>;
      };
    };
    if (!g.__KAI_NOTIF_STORE__) return 0;
    let count = 0;
    for (const n of notifs as unknown as { id: string; userId: string; type: string; title: string; body: string; read: boolean; link: string | null; createdAt: Date }[]) {
      const list = g.__KAI_NOTIF_STORE__.notificationsByUser.get(n.userId) ?? [];
      list.push({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        read: n.read,
        createdAt: n.createdAt.getTime(),
        link: n.link ?? undefined,
      });
      g.__KAI_NOTIF_STORE__.notificationsByUser.set(n.userId, list);
      count++;
    }
    if (!g.__KAI_NOTIF_STORE__.prefsByUser) g.__KAI_NOTIF_STORE__.prefsByUser = new Map();
    for (const p of prefs as unknown as {
      userId: string; emailDigest: boolean; kbReady: boolean; agentDone: boolean;
      securityAlert: boolean; teamActivity?: boolean;
    }[]) {
      g.__KAI_NOTIF_STORE__.prefsByUser.set(p.userId, {
        emailDigest: p.emailDigest,
        kbReady: p.kbReady,
        agentDone: p.agentDone,
        securityAlert: p.securityAlert,
        // Rows created before the team-activity channel existed default to on.
        teamActivity: p.teamActivity ?? true,
      });
    }
    // Keep the same 50-item cap as notify() so memory doesn't grow beyond the
    // in-process contract (DB retains the full history).
    for (const list of g.__KAI_NOTIF_STORE__.notificationsByUser.values()) {
      (list as { createdAt: number }[]).sort((a, b) => b.createdAt - a.createdAt).splice(50);
    }
    markNotificationsHydrated();
    return count;
  } catch (err) {
    log.error({ err }, "[db] hydrateNotifications error");
    throw err;
  }
}

/** Hydrate current-month workspace usage from UsageDaily (quota source). */

export async function hydrateUsage(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  try {
    const d = db as unknown as {
      usageDaily: { findMany: (o?: unknown) => Promise<unknown[]> };
      userUsageDaily: { findMany: (o?: unknown) => Promise<unknown[]> };
    };
    const rows = await d.usageDaily.findMany({ where: { day: { gte: monthStart } } });
    const totals = new Map<string, { qa: number; agent: number }>();
    for (const r of rows as unknown as {
      workspaceId: string;
      qaCount: bigint | number;
      agentCount: bigint | number;
    }[]) {
      const t = totals.get(r.workspaceId) ?? { qa: 0, agent: 0 };
      t.qa += Number(r.qaCount);
      t.agent += Number(r.agentCount);
      totals.set(r.workspaceId, t);
    }
    for (const [workspaceId, t] of totals) {
      hydrateWorkspaceUsage(workspaceId, t.qa, t.agent);
    }

    // Per-user counters + 14-day trend. Query from the earlier of the month
    // start and the 14-day window so early-month rows aren't dropped.
    const trendStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 13));
    const userQueryStart = new Date(Math.min(monthStart.getTime(), trendStart.getTime()));
    const userRows = await d.userUsageDaily.findMany({ where: { day: { gte: userQueryStart } } });
    type DayCounts = { qa: number; api: number; agent: number };
    const userAgg = new Map<string, {
      qa: number; api: number; agent: number;
      days: Map<string, DayCounts>;
    }>();
    for (const r of userRows as unknown as {
      userId: string;
      day: Date;
      qaCount: bigint | number;
      apiCount: bigint | number;
      agentCount: bigint | number;
    }[]) {
      const key = r.day.toISOString().slice(0, 10);
      const agg = userAgg.get(r.userId) ?? { qa: 0, api: 0, agent: 0, days: new Map() };
      const day = agg.days.get(key) ?? { qa: 0, api: 0, agent: 0 };
      day.qa += Number(r.qaCount);
      day.api += Number(r.apiCount);
      day.agent += Number(r.agentCount);
      agg.days.set(key, day);
      if (r.day >= monthStart) {
        agg.qa += Number(r.qaCount);
        agg.api += Number(r.apiCount);
        agg.agent += Number(r.agentCount);
      }
      userAgg.set(r.userId, agg);
    }
    for (const [userId, agg] of userAgg) {
      const trend: UsagePoint[] = [];
      for (let i = 13; i >= 0; i--) {
        const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - i));
        const rec = agg.days.get(day.toISOString().slice(0, 10)) ?? { qa: 0, api: 0, agent: 0 };
        trend.push({
          date: `${day.getUTCMonth() + 1}/${day.getUTCDate()}`,
          qa: rec.qa,
          api: rec.api,
          agent: rec.agent,
        });
      }
      hydrateUserUsage(userId, { qa: agg.qa, api: agg.api, agent: agg.agent }, trend);
    }
    return rows.length + userRows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateUsage error");
    throw err;
  }
}

// ── Team hydration (team info + members + audit + kbAccess) ──────────────

