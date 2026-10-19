// 安全中心（settings/security tab）：2FA（真 TOTP 流程）、会话管理、
// 登录历史、隐私设置、账号删除。契约与 /api/security* 冻结一致。
import { api } from "./client";

export interface TwoFactorState {
  enabled: boolean;
  enrolledAt?: number;
  backupCodesRemaining?: number;
}

export interface SecuritySession {
  id: string;
  device: string;
  browser: string;
  ip: string;
  location: string;
  lastActive: number;
  current: boolean;
}

export interface LoginHistoryEntry {
  id: string;
  device: string;
  location: string;
  ip: string;
  success: boolean;
  ts: number;
}

export interface PrivacySettings {
  analytics: boolean;
  crashReports: boolean;
  trainingOptIn: boolean;
  dataRetentionDays: number;
}

export interface SecurityState {
  twoFactor: TwoFactorState;
  sessions: SecuritySession[];
  loginHistory: LoginHistoryEntry[];
  privacy: PrivacySettings;
}

export async function fetchSecurity(): Promise<SecurityState | null> {
  return api.get<SecurityState>("/api/security");
}

export type EnrollData = { secret: string; qrCodeDataUrl: string; backupCodes: string[] };

export async function twofa(
  action: "enroll" | "verify" | "disable",
  code?: string
): Promise<(Partial<EnrollData> & { ok?: boolean }) | null> {
  return api.post("/api/security/2fa", {
    action,
    ...(code ? { code } : {}),
  });
}

export function revokeSession(id: string): Promise<unknown> {
  return api.del(`/api/security/sessions/${id}`);
}

export function revokeAllSessions(): Promise<unknown> {
  return api.del("/api/security/sessions");
}

export function patchPrivacy(patch: Partial<PrivacySettings>): Promise<unknown> {
  return api.patch("/api/security/privacy", patch);
}

export function deleteAccount(): Promise<unknown> {
  return api.del("/api/auth/me");
}
