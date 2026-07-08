import type { Subscription, Invoice, Usage, Order, PlanId, PayMethod } from "./types";
import { getPlan } from "./plans";

type Store = {
  subscription: Subscription;
  invoices: Invoice[];
  usage: Usage;
  orders: Map<string, Order>;
  seeded: boolean;
};

const g = globalThis as unknown as { __KAI_BILLING_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_BILLING_STORE__) {
    g.__KAI_BILLING_STORE__ = {
      subscription: {
        plan: "pro", status: "active",
        periodStart: monthStart(), periodEnd: monthEnd(),
        seats: 6, paymentMethod: { type: "alipay", label: "支付宝" },
        cancelAtPeriodEnd: false,
      },
      invoices: [], usage: {} as Usage, orders: new Map(), seeded: false,
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

function genTrend() {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      qa: Math.round(40 + Math.random() * 60),
      api: Math.round(80 + Math.random() * 120),
      agent: Math.round(1 + Math.random() * 5),
    });
  }
  return out;
}

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const now = Date.now();
  const day = 1000 * 60 * 60 * 24;

  // past invoices (pro monthly)
  const invoices: Invoice[] = [];
  for (let i = 1; i <= 5; i++) {
    invoices.push({
      id: `INV-${2026000 + i}`,
      date: now - i * 30 * day,
      amount: 49,
      plan: "pro",
      status: i === 1 ? "paid" : "paid",
      method: "alipay",
    });
  }
  s.invoices = invoices;

  s.usage = {
    qaUsed: 1284, qaLimit: null, // pro = unlimited
    apiCalls: 3420,
    storageUsed: 248 * 1024 * 1024, storageLimit: 1024 * 1024 * 1024, // 248MB / 1GB
    agentTasks: 23, agentLimit: 100,
    trend: genTrend(),
  };
}

export function getSubscription(): Subscription {
  seed();
  return store().subscription;
}

export function getUsage(): Usage {
  seed();
  return store().usage;
}

export function listInvoices(): Invoice[] {
  seed();
  return [...store().invoices].sort((a, b) => b.date - a.date);
}

// Create a pending order for an upgrade/subscribe.
export function createOrder(plan: PlanId, method: PayMethod): Order {
  seed();
  const p = getPlan(plan);
  const order: Order = {
    id: uid("ord"),
    plan,
    amount: p.price ?? 0,
    method,
    status: "pending",
    createdAt: Date.now(),
  };
  store().orders.set(order.id, order);
  return order;
}

// Simulate payment processing.
// 🔌 Integration point: replace with Stripe PaymentIntent / 微信支付统一下单
// + async webhook confirmation.
export function payOrder(orderId: string): { order: Order; success: boolean } {
  seed();
  const s = store();
  const order = s.orders.get(orderId);
  if (!order) return { order: {} as Order, success: false };
  order.status = "paid";
  // upgrade subscription
  const plan = getPlan(order.plan);
  s.subscription = {
    ...s.subscription,
    plan: order.plan,
    status: "active",
    paymentMethod: { type: order.method, label: labelFor(order.method) },
    cancelAtPeriodEnd: false,
    periodStart: Date.now(),
    periodEnd: monthEnd(),
  };
  // create invoice
  s.invoices.unshift({
    id: `INV-${2026000 + s.invoices.length + 1}`,
    date: Date.now(),
    amount: plan.price ?? 0,
    plan: order.plan,
    status: "paid",
    method: order.method,
  });
  // update usage limits to new plan
  s.usage.qaLimit = plan.qaLimit;
  s.usage.storageLimit = plan.id === "enterprise" ? null : 1024 * 1024 * 1024;
  s.usage.agentLimit = plan.agent ? (plan.id === "enterprise" ? null : 100) : 0;
  return { order, success: true };
}

export function cancelSubscription(): Subscription {
  seed();
  const s = store();
  s.subscription.cancelAtPeriodEnd = true;
  s.subscription.status = "canceled";
  return s.subscription;
}

export function resumeSubscription(): Subscription {
  seed();
  const s = store();
  s.subscription.cancelAtPeriodEnd = false;
  s.subscription.status = "active";
  return s.subscription;
}

function labelFor(m: PayMethod) {
  return m === "wechat" ? "微信支付" : m === "alipay" ? "支付宝" : "信用卡";
}
