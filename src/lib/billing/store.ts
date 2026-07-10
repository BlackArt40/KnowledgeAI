import type { Subscription, Invoice, Usage, UsagePoint, Order, PlanId, PayMethod } from "./types";
import { getPlan } from "./plans";
import { getUserById, updateUserPlan } from "@/lib/auth/store";

// ── Per-user billing store ───────────────────────────────────────────────
// Subscriptions, invoices, and orders are all tracked per-user so each user
// sees only their own billing data.

type Store = {
  subscriptionsByUser: Map<string, Subscription>;
  invoicesByUser: Map<string, Invoice[]>;
  orders: Map<string, Order & { userId: string }>;
  usageByUser: Map<string, Usage>;
  seeded: boolean;
};

const g = globalThis as unknown as { __KAI_BILLING_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_BILLING_STORE__) {
    g.__KAI_BILLING_STORE__ = {
      subscriptionsByUser: new Map(),
      invoicesByUser: new Map(),
      orders: new Map(),
      usageByUser: new Map(),
      seeded: false,
    };
  } else if (!g.__KAI_BILLING_STORE__.subscriptionsByUser) {
    // HMR migration: old singleton shape → re-init per-user maps.
    g.__KAI_BILLING_STORE__ = {
      subscriptionsByUser: new Map(),
      invoicesByUser: new Map(),
      orders: new Map(),
      usageByUser: new Map(),
      seeded: false,
    };
  }
  return g.__KAI_BILLING_STORE__;
}

function monthStart() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime();
}
function monthEnd() {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); return d.getTime();
}
function uid(p: string) { return `${p}_${Math.random().toString(36).slice(2, 10)}`; }

function dayLabel(offset = 0): string {
  const d = new Date(); d.setDate(d.getDate() - offset);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function labelFor(method: PayMethod): string {
  return method === "wechat" ? "微信支付" : method === "alipay" ? "支付宝" : "信用卡";
}

// A fresh per-user usage meter.
function emptyUsage(): Usage {
  const trend: UsagePoint[] = [];
  for (let i = 13; i >= 0; i--) trend.push({ date: dayLabel(i), qa: 0, api: 0, agent: 0 });
  return {
    qaUsed: 0, qaLimit: null,
    apiCalls: 0,
    storageUsed: 0, storageLimit: null,
    agentTasks: 0, agentLimit: null,
    trend,
  };
}

// Derive a default subscription from the user's current plan.
function defaultSubscription(userId: string): Subscription {
  const user = getUserById(userId);
  const plan = user?.plan ?? "free";
  const planDef = getPlan(plan);
  return {
    plan,
    status: "active",
    periodStart: monthStart(),
    periodEnd: monthEnd(),
    seats: planDef.seats ?? 1,
    paymentMethod: undefined,
    cancelAtPeriodEnd: false,
  };
}

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const now = Date.now();
  const day = 1000 * 60 * 60 * 24;

  // Seed realistic subscriptions + invoices for demo users based on their plans.
  const seedUsers = [
    { id: "usr_owner", plan: "enterprise" as PlanId, price: 299 },
    { id: "usr_admin", plan: "pro" as PlanId, price: 49 },
    { id: "usr_editor", plan: "pro" as PlanId, price: 49 },
    // viewer is free - no subscription/invoices
  ];

  for (const su of seedUsers) {
    s.subscriptionsByUser.set(su.id, {
      plan: su.plan,
      status: "active",
      periodStart: monthStart(),
      periodEnd: monthEnd(),
      seats: su.plan === "enterprise" ? 50 : 10,
      paymentMethod: { type: "alipay", label: "支付宝" },
      cancelAtPeriodEnd: false,
    });

    // 5 past monthly invoices
    const invoices: Invoice[] = [];
    for (let i = 1; i <= 5; i++) {
      invoices.push({
        id: `INV-${su.id.slice(4)}-${2026000 + i}`,
        date: now - i * 30 * day,
        amount: su.price,
        plan: su.plan,
        status: "paid",
        method: "alipay",
      });
    }
    s.invoicesByUser.set(su.id, invoices);
  }
}

// ── Subscription ─────────────────────────────────────────────────────────

export function getSubscription(userId: string): Subscription {
  seed();
  const s = store();
  return s.subscriptionsByUser.get(userId) ?? defaultSubscription(userId);
}

export function cancelSubscription(userId: string): Subscription {
  seed();
  const s = store();
  const sub = s.subscriptionsByUser.get(userId) ?? defaultSubscription(userId);
  sub.cancelAtPeriodEnd = true;
  sub.status = "canceled";
  s.subscriptionsByUser.set(userId, sub);
  return sub;
}

export function resumeSubscription(userId: string): Subscription {
  seed();
  const s = store();
  const sub = s.subscriptionsByUser.get(userId) ?? defaultSubscription(userId);
  sub.cancelAtPeriodEnd = false;
  sub.status = "active";
  s.subscriptionsByUser.set(userId, sub);
  return sub;
}

// ── Invoices ─────────────────────────────────────────────────────────────

export function listInvoices(userId: string): Invoice[] {
  seed();
  const s = store();
  return [...(s.invoicesByUser.get(userId) ?? [])].sort((a, b) => b.date - a.date);
}

/** Admin: list ALL invoices across all users (for revenue trend). */
export function listAllInvoices(): Invoice[] {
  seed();
  const s = store();
  const all: Invoice[] = [];
  for (const invs of s.invoicesByUser.values()) all.push(...invs);
  return all.sort((a, b) => b.date - a.date);
}

// ── Usage (per-user, unchanged) ──────────────────────────────────────────

export function getUsage(userId: string): Usage {
  seed();
  const s = store();
  let u = s.usageByUser.get(userId);
  if (!u) {
    u = emptyUsage();
    s.usageByUser.set(userId, u);
  }
  return u;
}

export function recordQa(userId: string): void {
  const u = getUsage(userId);
  u.qaUsed += 1;
  u.apiCalls += 1;
  const today = dayLabel(0);
  let pt = u.trend[u.trend.length - 1];
  if (!pt || pt.date !== today) {
    pt = { date: today, qa: 0, api: 0, agent: 0 };
    u.trend.push(pt);
    if (u.trend.length > 14) u.trend.shift();
  }
  pt.qa += 1;
  pt.api += 1;
}

// ── Orders + payment ─────────────────────────────────────────────────────

export function createOrder(plan: PlanId, method: PayMethod, userId: string): Order {
  seed();
  const p = getPlan(plan);
  const order: Order & { userId: string } = {
    id: uid("ord"),
    plan,
    amount: p.price ?? 0,
    method,
    status: "pending",
    createdAt: Date.now(),
    userId,
  };
  store().orders.set(order.id, order);
  return order;
}

export function getOrder(orderId: string): (Order & { userId: string }) | undefined {
  seed();
  return store().orders.get(orderId);
}

export function payOrder(orderId: string, userId: string): { order: Order; success: boolean } {
  seed();
  const s = store();
  const order = s.orders.get(orderId);
  if (!order || order.userId !== userId) return { order: {} as Order, success: false };
  order.status = "paid";

  const planDef = getPlan(order.plan);

  // Update the user's actual plan in the auth store.
  updateUserPlan(userId, order.plan);

  // Update per-user subscription.
  s.subscriptionsByUser.set(userId, {
    plan: order.plan,
    status: "active",
    periodStart: Date.now(),
    periodEnd: monthEnd(),
    seats: planDef.seats ?? 1,
    paymentMethod: { type: order.method, label: labelFor(order.method) },
    cancelAtPeriodEnd: false,
  });

  // Create per-user invoice.
  const invoices = s.invoicesByUser.get(userId) ?? [];
  invoices.unshift({
    id: `INV-${userId.slice(4)}-${Date.now().toString().slice(-6)}`,
    date: Date.now(),
    amount: planDef.price ?? 0,
    plan: order.plan,
    status: "paid",
    method: order.method,
  });
  s.invoicesByUser.set(userId, invoices);

  return { order, success: true };
}

/** Delete all billing data for a user (account deletion). */
export function deleteBillingData(userId: string): void {
  const s = store();
  s.subscriptionsByUser.delete(userId);
  s.invoicesByUser.delete(userId);
  s.usageByUser.delete(userId);
  // Delete user's orders
  for (const [id, order] of s.orders) {
    if (order.userId === userId) s.orders.delete(id);
  }
}
