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

import { getDb } from "../prisma";








import { log } from "@/lib/obs/log";


// P1-9: coalesce concurrent first-request calls (the proxy fires
// ensureHydrated() fire-and-forget on every request) into a single in-flight
// hydration promise - the old code ran hydrateFromDb() N times in parallel,
// duplicating rows in the in-memory stores. Reset on settle so a FAILED
// hydration (see P1-10) retries on the next request.

/** Whether hydration has been completed. */
export async function hydrateTeam(): Promise<{ team: number; members: number; audit: number }> {
  const db = await getDb();
  if (!db) return { team: 0, members: 0, audit: 0 };
  const g = globalThis as unknown as {
    __KAI_TEAM_STORE__?: {
      team: { id: string; name: string; logoInitial: string; plan: string; createdAt: number };
      members: Map<string, unknown>;
      audit: unknown[];
      kbAccess: Map<string, string>;
      kbMemberRoles: Map<string, Record<string, string>>;
      seeded: boolean;
    };
  };
  if (!g.__KAI_TEAM_STORE__) return { team: 0, members: 0, audit: 0 };
  const store = g.__KAI_TEAM_STORE__;
  try {
    const t = db as unknown as {
      team: { findUnique: (o: unknown) => Promise<Record<string, unknown> | null> };
    };
    const teamRow = await t.team.findUnique({ where: { id: "team_default" } });
    if (teamRow) {
      store.team = {
        id: teamRow.id as string,
        name: teamRow.name as string,
        logoInitial: (teamRow.logoInitial as string) ?? "K",
        plan: (teamRow.plan as string) ?? "专业版",
        createdAt: (teamRow.createdAt as Date).getTime(),
      };
      const ka = teamRow.kbAccess as Record<string, string> | null;
      if (ka && typeof ka === "object") {
        for (const [k, v] of Object.entries(ka)) store.kbAccess.set(k, v);
      }
      // M-7: restore per-KB member role overrides (kbId -> email -> role) -
      // they used to be memory-only and vanished on restart (P4-2 drift).
      const kmr = teamRow.kbMemberRoles as Record<string, Record<string, string>> | null;
      if (kmr && typeof kmr === "object") {
        for (const [kbId, roles] of Object.entries(kmr)) {
          if (roles && typeof roles === "object") store.kbMemberRoles.set(kbId, roles);
        }
      }
    }

    const tm = db as unknown as {
      teamMember: { findMany: (o?: unknown) => Promise<Record<string, unknown>[]> };
    };
    const members = await tm.teamMember.findMany({
      where: { teamId: "team_default" },
      orderBy: { joinedAt: "desc" },
    });
    store.members.clear();
    for (const m of members) {
      const user = await db.user.findUnique({ where: { id: m.userId as string } });
      if (!user) continue;
      store.members.set(m.id as string, {
        id: m.id,
        name: user.name,
        email: user.email,
        role: String(m.role ?? "EDITOR").toLowerCase(),
        status: user.status === "BANNED" ? "suspended" : "active",
        lastActiveAt: user.lastLoginAt ? user.lastLoginAt.getTime() : user.createdAt.getTime(),
        joinedAt: (m.joinedAt as Date).getTime(),
      });
    }

    const al = db as unknown as {
      auditLog: { findMany: (o?: unknown) => Promise<Record<string, unknown>[]> };
    };
    const audit = await al.auditLog.findMany({
      where: { teamId: "team_default" },
      orderBy: { createdAt: "desc" },
    });
    store.audit = audit.map((a) => ({
      id: a.id,
      actor: (a.actor as string) ?? "",
      action: a.action as string,
      target: (a.target as string) ?? "",
      detail: a.detail as string,
      createdAt: (a.createdAt as Date).getTime(),
    }));

    return { team: teamRow ? 1 : 0, members: members.length, audit: audit.length };
  } catch (err) {
    log.error({ err }, "[db] hydrateTeam error");
    return { team: 0, members: 0, audit: 0 };
  }
}

// ── Workspace hydration (P5-5) ────────────────────────────────────────────

/**
 * Merge DB workspace rows into __KAI_WORKSPACE_STORE__. `members` stay
 * memory-only (the Workspace table has no member relation yet), so seeded
 * workspaces keep their member lists while name/plan/ownerId/brandColor
 * survive restarts. DB-only rows (created in a previous process) are added
 * with an empty member list.
 */


export async function hydrateWorkspace(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as { __KAI_WORKSPACE_STORE__?: Map<string, unknown> };
  if (!g.__KAI_WORKSPACE_STORE__) return 0;
  const store = g.__KAI_WORKSPACE_STORE__;
  try {
    const rows = await db.workspace.findMany({});
    for (const w of rows) {
      const existing = store.get(w.id) as
        | { members?: string[]; createdAt?: number }
        | undefined;
      const dbMembers = (w as unknown as { members?: string[] }).members ?? [];
      store.set(w.id, {
        id: w.id,
        name: w.name,
        plan: w.plan,
        ownerId: w.ownerId,
        brandColor: w.brandColor ?? "indigo",
        // D2: prefer the persisted member list. Legacy rows created before the
        // column existed come back as [] - keep the in-memory seed for
        // ws_default in that case so existing installs don't lose their demo
        // membership (and their tenant resolution) after an upgrade.
        members: dbMembers.length > 0 ? dbMembers : existing?.members ?? [],
        createdAt: existing?.createdAt ?? w.createdAt.getTime(),
      });
    }
    return rows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateWorkspace error");
    throw err;
  }
}

// ── P7-1: Webhook subscription hydration ──────────────────────────────────

/**
 * Merge DB webhook subscription rows into __KAI_WEBHOOK_STORE__ so configured
 * endpoints + delivery state survive restarts. Subscriptions created in a
 * previous process land in the store; memory-only delivery records stay lost
 * (they are a short ring buffer by design).
 */

