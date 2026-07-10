import type { AdminUser, AdminOverview, KbMonitor, SystemConfig, UserStatus } from "./types";
import { listUsers as authListUsers, getUserById, setUserStatus as authSetUserStatus } from "@/lib/auth/store";
import { listAllKbs, listDocuments, totalStorageBytes } from "@/lib/kb/store";
import { getUsage, listAllInvoices } from "@/lib/billing/store";
import { listTasks } from "@/lib/agent/store";
import { getPlan } from "@/lib/billing/plans";

// ── System config (in-memory, the only piece that was already real) ──────

type Store = { config: SystemConfig };
const g = globalThis as unknown as { __KAI_ADMIN_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_ADMIN_STORE__) {
    g.__KAI_ADMIN_STORE__ = {
      config: {
        defaultModel: "gpt-4o",
        embeddingModel: "bge-m3",
        rateLimitPerMin: 60,
        maxUploadMb: 50,
        maintenanceMode: false,
        allowSignup: true,
      },
    };
  }
  return g.__KAI_ADMIN_STORE__;
}

// ── Users ────────────────────────────────────────────────────────────────

/** Build AdminUser records from the real auth store, enriched with KB/doc
 *  counts from the KB store and QA usage from the billing store. */
export function listUsers(): AdminUser[] {
  const users = authListUsers();
  return users.map((u) => {
    const userKbs = listAllKbs().filter((kb) => kb.ownerId === u.id);
    const docs = userKbs.reduce((sum, kb) => sum + listDocuments(kb.id).length, 0);
    const usage = getUsage(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      plan: u.plan,
      status: (u.status ?? "active") as UserStatus,
      role: u.role,
      kbs: userKbs.length,
      docs,
      lastActive: u.lastLoginAt ?? u.createdAt,
      joinedAt: u.createdAt,
    };
  }).sort((a, b) => b.joinedAt - a.joinedAt);
}

export function setUserStatus(id: string, status: UserStatus): AdminUser | null {
  const updated = authSetUserStatus(id, status);
  if (!updated) return null;
  // Re-derive the enriched record.
  const userKbs = listAllKbs().filter((kb) => kb.ownerId === updated.id);
  const docs = userKbs.reduce((sum, kb) => sum + listDocuments(kb.id).length, 0);
  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    plan: updated.plan,
    status,
    role: updated.role,
    kbs: userKbs.length,
    docs,
    lastActive: updated.lastLoginAt ?? updated.createdAt,
    joinedAt: updated.createdAt,
  };
}

// ── Overview stats ───────────────────────────────────────────────────────

const DAY = 86400000;
const PLAN_PRICE: Record<string, number> = { free: 0, pro: 49, enterprise: 299 };

function monthLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月`;
}

export function getOverview(): AdminOverview {
  const users = authListUsers();
  const allKbs = listAllKbs();
  const allTasks = listTasks();
  const now = Date.now();
  const monthStart = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); })();

  // Active = logged in within 30 days (fallback to createdAt if never logged in)
  const active30d = users.filter(
    (u) => (u.lastLoginAt ?? u.createdAt) > now - 30 * DAY
  ).length;

  // Monthly revenue: sum of plan prices for non-banned users
  const monthlyRevenue = users
    .filter((u) => (u.status ?? "active") !== "banned")
    .reduce((sum, u) => sum + (PLAN_PRICE[u.plan] ?? 0), 0);

  // Total docs across all KBs
  const totalDocs = allKbs.reduce((sum, kb) => sum + listDocuments(kb.id).length, 0);

  // QA this month: sum of all users' qaUsed
  const qaThisMonth = users.reduce((sum, u) => sum + getUsage(u.id).qaUsed, 0);

  // Agent tasks this month
  const agentTasksThisMonth = allTasks.filter((t) => t.createdAt >= monthStart).length;

  // Storage in GB
  const storageBytes = totalStorageBytes();
  const storageUsedGb = +(storageBytes / 1e9).toFixed(1);

  // Revenue trend: last 6 months from invoices, fall back to current MRR
  const invoices = listAllInvoices();
  const trend: { month: string; revenue: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i, 1); d.setHours(0,0,0,0);
    const start = d.getTime();
    const end = start + 31 * DAY;
    const label = monthLabel(start);
    const invRev = invoices
      .filter((inv) => inv.date >= start && inv.date < end && inv.status === "paid")
      .reduce((s, inv) => s + inv.amount, 0);
    // For the current month, use computed MRR (more accurate than invoices).
    const revenue = i === 0 ? monthlyRevenue : invRev;
    trend.push({ month: label, revenue });
  }

  // Recent signups: last 6 users by createdAt
  const recentSignups = [...users]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6)
    .map((u) => {
      const userKbs = listAllKbs().filter((kb) => kb.ownerId === u.id);
      const docs = userKbs.reduce((sum, kb) => sum + listDocuments(kb.id).length, 0);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        plan: u.plan,
        status: (u.status ?? "active") as UserStatus,
        role: u.role,
        kbs: userKbs.length,
        docs,
        lastActive: u.lastLoginAt ?? u.createdAt,
        joinedAt: u.createdAt,
      };
    });

  return {
    stats: {
      totalUsers: users.length,
      activeUsers30d: active30d,
      totalKbs: allKbs.length,
      totalDocs,
      monthlyRevenue,
      qaThisMonth,
      agentTasksThisMonth,
      storageUsedGb,
    },
    recentSignups,
    revenueTrend: trend,
  };
}

// ── KB monitor ───────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function listKbs(): KbMonitor[] {
  const allKbs = listAllKbs();
  return allKbs.map((kb) => {
    const docs = listDocuments(kb.id);
    const owner = getUserById(kb.ownerId);
    const sizeBytes = docs.reduce((sum, d) => sum + Math.max(0, d.size), 0);
    // Status: "processing" if any doc is still processing, "error" if any
    // errored, otherwise "ready".
    const statuses = docs.map((d) => d.status);
    const status: KbMonitor["status"] = statuses.some((s) =>
      ["queued", "parsing", "chunking", "vectorizing"].includes(s)
    ) ? "processing"
      : statuses.some((s) => s === "failed") ? "error"
      : "ready";

    return {
      id: kb.id,
      name: kb.name,
      owner: owner?.name ?? "未知",
      docs: docs.length,
      size: formatSize(sizeBytes),
      status,
      queries: 0, // per-KB query tracking not yet implemented
      updatedAt: kb.updatedAt,
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── System config (unchanged - was already real) ────────────────────────

export function getConfig(): SystemConfig {
  return store().config;
}

export function updateConfig(patch: Partial<SystemConfig>): SystemConfig {
  const s = store();
  s.config = { ...s.config, ...patch };
  return s.config;
}
