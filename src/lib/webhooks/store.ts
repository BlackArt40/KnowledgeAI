// ---------------------------------------------------------------------------
// Webhook subscription store (P7-1).
//
// In-memory store on globalThis (source of truth for reads) with write-through
// persistence (persistWebhookSubscription / deleteWebhookSubscriptionFromDb).
// Follows the P0-4 triad pattern: store.ts -> persist.ts -> hydrate.ts ->
// prisma/schema.prisma.
// ---------------------------------------------------------------------------

import type { WebhookSubscription, WebhookEvent, DeliveryRecord, WebhookEventPayload } from "./types";
import { WEBHOOK_EVENTS } from "./types";
import { persistWebhookSubscription, deleteWebhookSubscriptionFromDb } from "@/lib/db/persist";
import { recordAudit } from "@/lib/security/audit";
import { log } from "@/lib/obs/log";

interface StoreShape {
  subs: Map<string, WebhookSubscription>;
  deliveries: DeliveryRecord[];
}

declare global {
  var __KAI_WEBHOOK_STORE__: StoreShape | undefined;
}

const MAX_DELIVERY_RECORDS = 100;

function store(): StoreShape {
  if (!globalThis.__KAI_WEBHOOK_STORE__) {
    globalThis.__KAI_WEBHOOK_STORE__ = { subs: new Map(), deliveries: [] };
  }
  return globalThis.__KAI_WEBHOOK_STORE__;
}

// ── CRUD ─────────────────────────────────────────────────────────────────

export function createWebhookSubscription(input: {
  userId: string; workspaceId: string; name: string; url: string;
  secret?: string; events: WebhookEvent[];
}): WebhookSubscription | null {
  const events = [...new Set(input.events)].filter((e) => WEBHOOK_EVENTS.includes(e));
  if (events.length === 0) return null;

  const sub: WebhookSubscription = {
    id: `whk_${crypto.randomUUID().slice(0, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name.trim() || "未命名",
    url: input.url,
    secret: input.secret ?? "",
    events,
    active: true,
    createdAt: Date.now(),
    lastDeliveryAt: null,
    failures: 0,
    lastError: null,
  };
  store().subs.set(sub.id, sub);
  void persistWebhookSubscription(sub);
  return sub;
}

export function listWebhookSubscriptions(workspaceId: string): WebhookSubscription[] {
  return [...store().subs.values()]
    .filter((s) => s.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getWebhookSubscription(id: string): WebhookSubscription | undefined {
  return store().subs.get(id);
}

export function updateWebhookSubscription(
  id: string,
  patch: Partial<Pick<WebhookSubscription, "name" | "url" | "secret" | "events" | "active">>
): WebhookSubscription | null {
  const sub = store().subs.get(id);
  if (!sub) return null;
  const events = patch.events ? [...new Set(patch.events)].filter((e) => WEBHOOK_EVENTS.includes(e)) : sub.events;
  if (patch.events && events.length === 0) return null;
  const next: WebhookSubscription = { ...sub, ...patch, events };
  store().subs.set(id, next);
  void persistWebhookSubscription(next);
  return next;
}

export function deleteWebhookSubscription(id: string): boolean {
  const existed = store().subs.delete(id);
  if (existed) void deleteWebhookSubscriptionFromDb(id);
  return existed;
}

/** Test helper (HMR-safe store reset). */
export function resetWebhookStore(): void {
  delete globalThis.__KAI_WEBHOOK_STORE__;
}

// ── Delivery helpers ─────────────────────────────────────────────────────

/** Validate a webhook URL (http/https only - never deliver to file:// etc.). */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Record one delivery attempt into the ring buffer. */
export function recordDelivery(record: Omit<DeliveryRecord, "id" | "ts">): void {
  const s = store();
  s.deliveries.unshift({ ...record, id: `dlv_${crypto.randomUUID().slice(0, 8)}`, ts: Date.now() });
  if (s.deliveries.length > MAX_DELIVERY_RECORDS) s.deliveries.length = MAX_DELIVERY_RECORDS;
}

/** List delivery records for ONE workspace (tenant boundary). Optionally
 *  narrow to a single subscription. Never call with a caller-supplied
 *  workspaceId omitted - that would leak records across tenants. */
export function listDeliveryRecords(workspaceId: string, subscriptionId?: string, limit = 30): DeliveryRecord[] {
  const all = store().deliveries.filter(
    (d) => d.workspaceId === workspaceId && (!subscriptionId || d.subscriptionId === subscriptionId)
  );
  return all.slice(0, limit);
}

/** Build the signed payload for an event (X-KAI-Signature: sha256=<hex>). */
export async function signWebhookPayload(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = enc.encode(secret || "");
  const data = enc.encode(body);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mark a subscription failed (dead-letter) or restored after a success. */
export function markDeliveryOutcome(
  subId: string,
  ok: boolean,
  detail?: string
): void {
  const sub = store().subs.get(subId);
  if (!sub) return;
  if (ok) {
    sub.lastDeliveryAt = Date.now();
    sub.failures = 0;
    sub.lastError = null;
  } else {
    sub.failures += 1;
    sub.lastError = detail ?? "投递失败";
  }
  void persistWebhookSubscription(sub);
}

/** Audit helper for sensitive webhook config changes. */
export function auditWebhook(
  actorId: string, actor: string, action: string, target: string, detail: string
): void {
  try {
    recordAudit({ actorId, actor, action, target, detail });
  } catch (err) {
    log.warn({ err }, "[webhooks] audit failed");
  }
}

/** Emit an event to every matching ACTIVE subscription in a workspace.
 *  Returns the number of delivery jobs enqueued (0 when nothing matches). */
export async function emitWebhookEvent(
  workspaceId: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<number> {
  const matches = [...store().subs.values()].filter(
    (s) => s.workspaceId === workspaceId && s.active && s.events.includes(event)
  );
  if (matches.length === 0) return 0;

  const { enqueue } = await import("@/lib/queue");
  for (const sub of matches) {
    const payload: WebhookEventPayload = { event, ts: Date.now(), data };
    await enqueue("webhook-deliver", { subscriptionId: sub.id, payload });
  }
  return matches.length;
}
