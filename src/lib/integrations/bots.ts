// ---------------------------------------------------------------------------
// Chat-bot integrations (P7-2): Slack / 飞书 / 钉钉 / test.
//
// A BotBinding ties a knowledge base to a platform webhook endpoint. The
// callback URL is POST /api/v1/integrations/bot/m/<token>; the token IS the
// credential (delivered once at creation, stored SHA-256-hashed - same
// pattern as P4-2 doc share links). Every bot has its own rate-limit tier
// (integration:<id>, RATE_LIMIT_INTEGRATION_PER_MIN) so one bot can't starve
// its owner's quota.
//
// The callback parses the platform's message payload, answers via the shared
// chat pipeline (askOnce), and replies in the platform's message format.
// ---------------------------------------------------------------------------

import type { RequestUser } from "@/lib/auth/guard";
import { persistBotIntegration, deleteBotIntegrationFromDb } from "@/lib/db/persist";
import { recordAudit } from "@/lib/security/audit";
import { log } from "@/lib/obs/log";

export type BotPlatform = "slack" | "feishu" | "dingtalk" | "test";

export const BOT_PLATFORMS: BotPlatform[] = ["slack", "feishu", "dingtalk", "test"];

export interface BotBinding {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  platform: BotPlatform;
  kbId: string;
  kbName?: string;
  /** SHA-256 hex of the plaintext token (never stored). */
  tokenHash: string;
  active: boolean;
  createdAt: number;
  calls: number;
}

interface StoreShape {
  bots: Map<string, BotBinding>;
  /** plaintext token -> binding id (session-only; enables the one-time reveal) */
  plaintextTokens: Map<string, string>;
}

declare global {
  var __KAI_BOT_STORE__: StoreShape | undefined;
}

function store(): StoreShape {
  if (!globalThis.__KAI_BOT_STORE__) {
    globalThis.__KAI_BOT_STORE__ = { bots: new Map(), plaintextTokens: new Map() };
  }
  return globalThis.__KAI_BOT_STORE__;
}

export function resetBotStore(): void {
  delete globalThis.__KAI_BOT_STORE__;
}

// ── Token helpers ─────────────────────────────────────────────────────────

export function newBotToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `kai_bot_${hex}`;
}

export async function hashBotToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── CRUD ─────────────────────────────────────────────────────────────────

export async function createBotBinding(input: {
  user: RequestUser; name: string; platform: BotPlatform; kbId: string; kbName?: string;
}): Promise<{ binding: BotBinding; token: string } | null> {
  const token = newBotToken();
  const binding: BotBinding = {
    id: `bot_${crypto.randomUUID().slice(0, 8)}`,
    userId: input.user.id,
    workspaceId: input.user.workspaceId,
    name: input.name.trim() || input.platform,
    platform: input.platform,
    kbId: input.kbId,
    kbName: input.kbName,
    tokenHash: await hashBotToken(token),
    active: true,
    createdAt: Date.now(),
    calls: 0,
  };
  store().bots.set(binding.id, binding);
  store().plaintextTokens.set(token, binding.id);
  void persistBotIntegration(binding);
  return { binding, token };
}

export function listBotBindings(workspaceId: string): BotBinding[] {
  return [...store().bots.values()]
    .filter((b) => b.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getBotBinding(id: string): BotBinding | undefined {
  return store().bots.get(id);
}

export function updateBotBinding(
  id: string,
  patch: Partial<Pick<BotBinding, "name" | "active">>
): BotBinding | null {
  const b = store().bots.get(id);
  if (!b) return null;
  const next = { ...b, ...patch };
  store().bots.set(id, next);
  void persistBotIntegration(next);
  return next;
}

export function deleteBotBinding(id: string): boolean {
  const existed = store().bots.delete(id);
  if (existed) void deleteBotIntegrationFromDb(id);
  return existed;
}

/** Look up a binding by its plaintext callback token (hash match). */
export async function getBotByToken(token: string): Promise<BotBinding | undefined> {
  if (!token.startsWith("kai_bot_")) return undefined;
  const hash = await hashBotToken(token);
  return [...store().bots.values()].find((b) => b.tokenHash === hash);
}

/** Increment the call counter on the binding. */
export function recordBotCall(id: string): void {
  const b = store().bots.get(id);
  if (!b) return;
  b.calls += 1;
  void persistBotIntegration(b);
}

export function auditBot(
  actorId: string, actor: string, action: string, target: string, detail: string
): void {
  try {
    recordAudit({ actorId, actor, action, target, detail });
  } catch (err) {
    log.warn({ err }, "[bots] audit failed");
  }
}

// ── Platform adapters ─────────────────────────────────────────────────────

export interface PlatformMessage {
  /** Free text to answer (null when the payload is a verification challenge). */
  text: string | null;
  /** Verification challenge to echo verbatim (Slack / 飞书 url_verification). */
  challenge: string | null;
}

/** Parse a platform callback payload into a message/challenge. */
export function parsePlatformMessage(platform: BotPlatform, body: unknown): PlatformMessage {
  const b = (body ?? {}) as Record<string, unknown>;
  const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const asObj = (v: unknown): Record<string, unknown> =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const clean = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);

  if (platform === "slack") {
    if (b.type === "url_verification" && typeof b.challenge === "string") {
      return { text: null, challenge: b.challenge };
    }
    if (b.type === "event_callback") {
      return { text: clean(asStr(asObj(b.event).text)), challenge: null };
    }
    return { text: clean(asStr(b.text)), challenge: null };
  }
  if (platform === "feishu") {
    if (b.type === "url_verification" && typeof b.challenge === "string") {
      return { text: null, challenge: b.challenge };
    }
    let text: string | null = null;
    const content = asObj(asObj(b.event).message).content;
    if (typeof content === "string") {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        text = clean(typeof parsed.text === "string" ? parsed.text : undefined);
      } catch {
        /* content not JSON - ignore */
      }
    }
    return { text, challenge: null };
  }
  if (platform === "dingtalk") {
    return { text: clean(asStr(asObj(b.text).content)), challenge: null };
  }
  // test platform: raw text passthrough
  return { text: clean(asStr(b.text)), challenge: null };
}

/** Build the platform-formatted reply body. */
export function buildPlatformReply(
  platform: BotPlatform, answer: string, fallback: string
): Record<string, unknown> {
  const text = answer || fallback;
  if (platform === "slack") return { text };
  if (platform === "feishu") return { msg_type: "text", content: { text } };
  if (platform === "dingtalk") return { msgtype: "text", text: { content: text } };
  return { answer, citations: [] };
}

/** Empty-message reply per platform (asked for nothing - prompt the user). */
export function buildEmptyReply(platform: BotPlatform, hint: string): Record<string, unknown> {
  return buildPlatformReply(platform, "", hint);
}
