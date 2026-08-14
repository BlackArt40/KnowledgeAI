import type { SecurityState, TwoFactor, PrivacySettings, Session } from "./types";
import type { ClientInfo } from "./ua";
import { generateSecret, generateOTPAuthURI, generateBackupCodes, hashBackupCode, verifyTOTP, verifyBackupCode } from "./totp";
import { deleteConversationsOlderThan } from "@/lib/chat/store";
import { getConfig } from "@/lib/admin/store";
import { log } from "@/lib/obs/log";

type UserState = SecurityState & { seeded: boolean; authVersion?: number };

interface Store {
  byUser: Map<string, UserState>;
}

const g = globalThis as unknown as { __KAI_SECURITY_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_SECURITY_STORE__ || !g.__KAI_SECURITY_STORE__.byUser) {
    // HMR migration: reset singletons created by an older store revision.
    g.__KAI_SECURITY_STORE__ = { byUser: new Map() };
  }
  return g.__KAI_SECURITY_STORE__;
}

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}

function blank(): UserState {
  return {
    twoFactor: { enabled: false, method: null, secret: null, backupCodes: [], backupCodesRemaining: 0, enrolledAt: null, pendingSecret: null, pendingBackupCodes: [] },
    sessions: [],
    loginHistory: [],
    privacy: { analytics: true, crashReports: true, trainingOptIn: false, dataRetentionDays: 90 },
    seeded: false,
    authVersion: 2,
  };
}

function stateFor(userId: string): UserState {
  const s = store();
  let st = s.byUser.get(userId);
  if (!st) {
    st = blank();
    s.byUser.set(userId, st);
  } else if (st.authVersion !== 2) {
    // Migrate away from older revisions that seeded fake login data: drop the
    // demo sessions/loginHistory so only real records remain.
    st.sessions = [];
    st.loginHistory = [];
    st.authVersion = 2;
  }
  return st;
}

function seed(userId: string) {
  const st = stateFor(userId);
  if (st.seeded) return;
  st.seeded = true;

  st.twoFactor = { enabled: false, method: null, secret: null, backupCodes: [], backupCodesRemaining: 0, enrolledAt: null, pendingSecret: null, pendingBackupCodes: [] };
  // sessions & loginHistory start empty - populated by real logins below.
}

function snapshot(st: UserState): SecurityState {
  // Sanitize for API responses: never leak hashed backup codes (committed or
  // pending). Expose only the remaining count so the UI can show "N 枚恢复码
  // 剩余" without revealing the hashes (which must never be displayed as if
  // they were usable codes). backupCodesRemaining is derived from
  // backupCodes.length so it can never drift from reality.
  return {
    twoFactor: {
      ...st.twoFactor,
      backupCodes: [],
      backupCodesRemaining: st.twoFactor.backupCodes.length,
      pendingBackupCodes: [],
    },
    sessions: st.sessions,
    loginHistory: st.loginHistory,
    privacy: st.privacy,
  };
}

export function getSecurity(userId: string): SecurityState {
  seed(userId);
  return snapshot(stateFor(userId));
}

// ── Real login tracking ───────────────────────────────────────────────────

/** Append a real login event to the user's history. */
export function recordLogin(
  userId: string,
  info: { device: string; ip: string; location: string; success: boolean }
): void {
  seed(userId);
  const st = stateFor(userId);
  st.loginHistory.unshift({
    id: uid("log"),
    device: info.device,
    ip: info.ip,
    location: info.location,
    success: info.success,
    ts: Date.now(),
  });
  if (st.loginHistory.length > 50) st.loginHistory.length = 50;
}

/** Register the current login as an active session (others become non-current). */
export function addSession(userId: string, info: ClientInfo): Session[] {
  seed(userId);
  const st = stateFor(userId);
  st.sessions.forEach((s) => (s.current = false));
  st.sessions.unshift({
    id: uid("ses"),
    device: info.device,
    browser: info.browser,
    ip: info.ip,
    location: info.location,
    current: true,
    lastActive: Date.now(),
  });
  return st.sessions;
}

/** Ensure the current session is represented (e.g. after a server restart
 *  cleared in-memory state). Only creates a session + history entry if no
 *  current session exists yet. */
export function ensureCurrentSession(userId: string, info: ClientInfo): void {
  seed(userId);
  const st = stateFor(userId);
  if (st.sessions.some((s) => s.current)) return;
  st.sessions.unshift({
    id: uid("ses"),
    device: info.device,
    browser: info.browser,
    ip: info.ip,
    location: info.location,
    current: true,
    lastActive: Date.now(),
  });
  st.loginHistory.unshift({
    id: uid("log"),
    device: info.device,
    ip: info.ip,
    location: info.location,
    success: true,
    ts: Date.now(),
  });
  if (st.loginHistory.length > 50) st.loginHistory.length = 50;
}

/** Start 2FA enrollment: generate TOTP secret + backup codes.
 *  Returns the secret + QR code URI for the user to scan.
 *  2FA is NOT enabled until verify2FAEnrollment() is called with a valid code. */
export function start2FAEnrollment(userId: string, email: string): {
  secret: string;
  qrCodeUri: string;
  backupCodes: string[];
} {
  seed(userId);
  const st = stateFor(userId);
  const secret = generateSecret();
  const qrCodeUri = generateOTPAuthURI(secret, email);
  const backupCodes = generateBackupCodes();
  st.twoFactor.pendingSecret = secret;
  st.twoFactor.method = "app";
  // Stage the hashed backup codes apart from `backupCodes`: they must not take
  // effect until enrollment is verified. Keeping `backupCodes` empty until then
  // means a snapshot (and backupCodesRemaining) correctly reports zero while
  // 2FA is still disabled, avoiding an inconsistent "enabled:false but 8 codes
  // remaining" state if the user abandons enrollment mid-flow.
  st.twoFactor.pendingBackupCodes = backupCodes.map(hashBackupCode);
  return { secret, qrCodeUri, backupCodes };
}

/** Verify the TOTP code during enrollment and activate 2FA. */
export function verify2FAEnrollment(userId: string, code: string): boolean {
  seed(userId);
  const st = stateFor(userId);
  const secret = st.twoFactor.pendingSecret;
  if (!secret) return false;
  if (!verifyTOTP(secret, code)) return false;
  st.twoFactor.enabled = true;
  st.twoFactor.secret = secret;
  st.twoFactor.pendingSecret = null;
  // Commit the staged backup codes now that enrollment is confirmed.
  st.twoFactor.backupCodes = st.twoFactor.pendingBackupCodes;
  st.twoFactor.pendingBackupCodes = [];
  st.twoFactor.enrolledAt = Date.now();
  return true;
}

/** Verify a TOTP code or backup code for login (when 2FA is enabled). */
export function verify2FALogin(userId: string, code: string): boolean {
  seed(userId);
  const st = stateFor(userId);
  if (!st.twoFactor.enabled || !st.twoFactor.secret) return false;
  // Try TOTP code first
  if (verifyTOTP(st.twoFactor.secret, code)) return true;
  // Try backup code (one-time use: consumed + auto-invalidated on success)
  const { valid, remaining } = verifyBackupCode(code, st.twoFactor.backupCodes);
  if (valid) {
    st.twoFactor.backupCodes = remaining;
    // backupCodesRemaining is a derived value: snapshot()/exportData() recompute
    // it from backupCodes.length, so it need not be maintained here.
    return true;
  }
  return false;
}

/** Check if a user has 2FA enabled. */
export function is2FAEnabled(userId: string): boolean {
  seed(userId);
  return stateFor(userId).twoFactor.enabled;
}

/** Whether 2FA is administratively required for a given role. */
export function is2FARequiredForRole(role: string): boolean {
  try {
    return getConfig().required2FARoles.includes(role);
  } catch (err) {
    // Fail CLOSED: an unreadable admin config must not silently weaken the
    // 2FA policy - treat the role as requiring 2FA and surface the problem.
    log.warn({ err }, "[security] 2FA required-roles config read failed - treating as required");
    return true;
  }
}

/** Whether a user must enroll in 2FA: their role requires it but they haven't
 *  enabled it yet. Used by the login flow to force enrollment. */
export function mustEnroll2FA(userId: string, role: string): boolean {
  return is2FARequiredForRole(role) && !is2FAEnabled(userId);
}

export function disable2FA(userId: string): TwoFactor {
  seed(userId);
  const st = stateFor(userId);
  st.twoFactor = { enabled: false, method: null, secret: null, backupCodes: [], backupCodesRemaining: 0, enrolledAt: null, pendingSecret: null, pendingBackupCodes: [] };
  return st.twoFactor;
}

export function revokeSession(userId: string, id: string): Session[] {
  seed(userId);
  const st = stateFor(userId);
  st.sessions = st.sessions.filter((x) => x.id !== id);
  return st.sessions;
}

export function revokeAllSessions(userId: string): Session[] {
  seed(userId);
  const st = stateFor(userId);
  st.sessions = st.sessions.filter((x) => x.current);
  return st.sessions;
}

export function updatePrivacy(userId: string, patch: Partial<PrivacySettings>): PrivacySettings {
  seed(userId);
  const st = stateFor(userId);
  st.privacy = { ...st.privacy, ...patch };
  return st.privacy;
}

/** Remove login history entries older than `cutoff`. Returns count removed. */
export function trimLoginHistory(userId: string, cutoff: number): number {
  seed(userId);
  const st = stateFor(userId);
  const before = st.loginHistory.length;
  st.loginHistory = st.loginHistory.filter((e) => e.ts >= cutoff);
  return before - st.loginHistory.length;
}

/** Run data-retention cleanup for a user: delete conversations and login
 *  history entries older than their configured `dataRetentionDays`.
 *  Returns a summary of what was cleaned. */
export function runRetentionCleanup(userId: string): {
  retentionDays: number;
  deletedConversations: number;
  trimmedLogins: number;
} {
  seed(userId);
  const st = stateFor(userId);
  const days = st.privacy.dataRetentionDays;
  const cutoff = Date.now() - days * 86400000;
  const deletedConversations = deleteConversationsOlderThan(userId, cutoff);
  const trimmedLogins = trimLoginHistory(userId, cutoff);
  return { retentionDays: days, deletedConversations, trimmedLogins };
}

/** Delete all security data for a user (account deletion). */
export function deleteSecurityData(userId: string): void {
  store().byUser.delete(userId);
}

// GDPR: export the user's data as a JSON string
export function exportData(userId: string): string {
  seed(userId);
  const st = stateFor(userId);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      // Mirror snapshot(): never leak hashed backup codes (committed or
      // pending), and recompute the remaining count from backupCodes.length so
      // it can't drift from the stored (possibly stale) backupCodesRemaining.
      twoFactor: {
        ...st.twoFactor,
        backupCodes: [],
        backupCodesRemaining: st.twoFactor.backupCodes.length,
        pendingBackupCodes: [],
      },
      sessions: st.sessions,
      loginHistory: st.loginHistory,
      privacy: st.privacy,
      note: "演示数据导出。生产环境将聚合用户全部数据（知识库、会话、账单等）。",
    },
    null, 2
  );
}
