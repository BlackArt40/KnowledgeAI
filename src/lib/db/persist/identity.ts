// ---------------------------------------------------------------------------
// Persistence - write-through layer that syncs in-memory store mutations
// to PostgreSQL.
//
// Each function is a fire-and-forget async operation:
//   - If DB is enabled: writes to Prisma (errors logged, not thrown)
//   - If DB is not configured: no-op
//
// The in-memory store remains the source of truth for reads (ADR-0001). The DB
// is the recovery copy that survives restarts; multi-instance shared reads still
// need a separate evolution per that ADR.
// ---------------------------------------------------------------------------


import { getDb, isDbEnabled } from "../prisma";
import { encryptToString } from "@/lib/crypto";
import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */


export async function persistUser(user: {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  role: string;
  status: string;
  plan: string;
  createdAt: number;
  lastLoginAt: number | null;
  /** P5-4: UI language preference. */
  locale?: string;
  /** P3-2: OAuth provider links (provider -> providerAccountId). */
  oauthLinks?: Record<string, string>;
  /** P8: password reset token hash + expiry (epoch ms). */
  passwordResetTokenHash?: string;
  passwordResetExpires?: number;
  /** P8: email verification state. */
  emailVerifiedAt?: number;
  verificationTokenHash?: string;
  verificationExpires?: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    // Atomic upsert: findUnique+create/update races (fire-and-forget writers)
    // could double-create the same row and hit the unique constraint.
    const data = {
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      role: user.role.toUpperCase(),
      status: user.status.toUpperCase(),
      // M-1: the plan tier used to be dropped here, so after a restart
      // hydrateUser defaulted everyone to "free" - paid features (unlimited
      // QA / Agent / API keys) silently downgraded. Persist it with the user.
      plan: user.plan ?? "free",
      // P1: lastLoginAt was declared on the input but never written, so every
      // restart reset it to null.
      lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
      locale: user.locale ?? "zh-CN",
      // OAuth links: JSONB column; null keeps rows backwards compatible.
      oauthLinks: user.oauthLinks ?? null,
      // P8: only the token HASH is persisted; null after use/expiry.
      passwordResetTokenHash: user.passwordResetTokenHash ?? null,
      passwordResetExpires: user.passwordResetExpires
        ? new Date(user.passwordResetExpires)
        : null,
      // P8: email verification state (timestamp + token hash + expiry).
      emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : null,
      verificationTokenHash: user.verificationTokenHash ?? null,
      verificationExpires: user.verificationExpires ? new Date(user.verificationExpires) : null,
    };
    await db.user.upsert({
      where: { id: user.id },
      update: data,
      create: { id: user.id, ...data },
    });
  } catch (err) {
    log.error({ err }, "[db] persistUser error");
  }
}

// ── Security state (2FA / sessions / login history / privacy) ─────────────
// The security store used to be memory-only, which silently disabled 2FA for
// every user after a restart. One row per user; JSON columns mirror the store
// shape and the TOTP secrets are encrypted at rest with AUTH_SECRET.


export async function persistSecurityState(userId: string, state: {
  twoFactor: {
    enabled: boolean;
    method: string | null;
    secret: string | null;
    backupCodes: string[];
    enrolledAt: number | null;
    pendingSecret: string | null;
    pendingBackupCodes: string[];
    lastUsedStep?: number | null;
  };
  sessions: unknown[];
  loginHistory: unknown[];
  privacy: unknown;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const twoFactor = {
      ...state.twoFactor,
      // Never store a TOTP secret in plaintext. Legacy/plaintext rows still
      // load (decryptFromString passes non-encrypted values through).
      secret: state.twoFactor.secret ? encryptToString(state.twoFactor.secret) : null,
      pendingSecret: state.twoFactor.pendingSecret ? encryptToString(state.twoFactor.pendingSecret) : null,
    };
    const data = {
      twoFactor: twoFactor as unknown,
      sessions: state.sessions as unknown,
      loginHistory: state.loginHistory as unknown,
      privacy: state.privacy as unknown,
      updatedAt: new Date(),
    };
    await db.userSecurity.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  } catch (err) {
    log.error({ err }, "[db] persistSecurityState error");
  }
}

/** Delete a user's security row (account deletion / GDPR erasure). */

export async function deleteSecurityStateFromDb(userId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.userSecurity.deleteMany({ where: { userId } });
  } catch (err) {
    log.error({ err }, "[db] deleteSecurityStateFromDb error");
  }
}

/** Delete a user row (account deletion).
 *
 *  Tables with a real FK to User are removed by the DB cascade; the tables
 *  below only store a plain `userId` column, so they would otherwise become
 *  orphaned rows (and retain PII / tokens) after the user is gone. */
