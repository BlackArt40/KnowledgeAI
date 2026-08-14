// ---------------------------------------------------------------------------
// Outgoing Webhook subscriptions (P7-1).
//
// A subscription is a user-configured HTTPS endpoint that receives signed
// event notifications. Events (P7-1):
//   kb.ready        - a document finished processing in a KB
//   agent.completed - an agent research task finished (successfully)
//   usage.alert     - a workspace crossed its plan usage threshold
//
// Delivery is fire-and-forget via the job queue (webhook-deliver): each job
// performs one HTTP attempt; the queue backend retries (3 attempts with
// exponential backoff in memory mode; BullMQ has its own retry + DLQ). Every
// delivery is signed HMAC-SHA256 with the subscription secret so receivers
// can verify authenticity (X-KAI-Signature: sha256=<hex>).
// ---------------------------------------------------------------------------

export type WebhookEvent = "kb.ready" | "agent.completed" | "usage.alert";

export const WEBHOOK_EVENTS: WebhookEvent[] = ["kb.ready", "agent.completed", "usage.alert"];

export interface WebhookSubscription {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  /** Receiver endpoint (http/https only - validated at creation). */
  url: string;
  /** HMAC-SHA256 signing secret. Empty string = unauthenticated delivery. */
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: number;
  /** Last successful delivery timestamp. */
  lastDeliveryAt: number | null;
  /** Delivery attempts so far (reset on success). */
  failures: number;
  /** Set when the subscription hit the dead-letter state (queue retries
   *  exhausted). Cleared on the next successful delivery. */
  lastError: string | null;
}

/** One delivery attempt record (ring buffer for the dev portal). */
export interface DeliveryRecord {
  id: string;
  subscriptionId: string;
  /** Tenant boundary - listDeliveryRecords MUST filter by this. */
  workspaceId: string;
  event: WebhookEvent;
  status: number | "error" | "dead";
  ts: number;
  latencyMs: number;
  detail?: string;
}

/** Payload emitted with an event. `event` names are part of the wire format. */
export interface WebhookEventPayload {
  event: WebhookEvent;
  ts: number;
  data: Record<string, unknown>;
}
