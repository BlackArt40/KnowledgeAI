// Stateless team-invite tokens: HMAC-signed payload, no DB row needed.
//
// The invite carries the invited email, role, target workspace and an expiry.
// Verification is constant-time; accepting is idempotent (activating a member
// twice keeps the same result), so a token does not need single-use storage.
// Revocation is bounded by the 7-day TTL.
import crypto from "crypto";
import { getAuthSecret } from "@/lib/secrets";
import type { Role } from "./types";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InvitePayload {
  email: string;
  role: Role;
  workspaceId: string;
  /** Unix ms expiry. */
  exp: number;
}

export type InviteVerifyResult =
  | { ok: true; payload: InvitePayload }
  | { ok: false; reason: "invalid" | "expired" };

function secret(): string {
  return getAuthSecret("kai-team-invite-dev-secret");
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signInviteToken(
  input: { email: string; role: Role; workspaceId: string },
  ttlMs: number = INVITE_TTL_MS,
  now: number = Date.now()
): string {
  const payload: InvitePayload = {
    email: input.email.trim().toLowerCase(),
    role: input.role,
    workspaceId: input.workspaceId,
    exp: now + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyInviteToken(token: string, now: number = Date.now()): InviteVerifyResult {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return { ok: false, reason: "invalid" };
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" };
  }
  let payload: InvitePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as InvitePayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !payload ||
    typeof payload.email !== "string" ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.exp !== "number" ||
    !["owner", "admin", "editor", "viewer"].includes(payload.role)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
