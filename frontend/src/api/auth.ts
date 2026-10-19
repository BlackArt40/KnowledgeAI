// 认证 API（V1 契约与 Next 侧 /api/auth/* 冻结契约一致）：
//   login        POST /api/auth/login {email,password,totpCode?}
//                → {token} | {requires2FA:true} | {mustEnroll2FA,preAuthToken}；服务端 Set-Cookie kai-token
//   register     POST /api/auth/register {name,email,password} → {user,token,needsVerification,demoVerifyUrl?}
//   verifyEmail  POST /api/auth/verify-email {token} → {ok,email}
//   resendVerify POST /api/auth/verify-email/resend {email} → {ok,demoVerifyUrl?}
//   forgotPwd    POST /api/auth/forgot-password {email} → {ok,demoResetUrl?（仅 demo）}
//   resetPwd     POST /api/auth/reset-password {token,password} → {ok:true}
//   enroll2fa    POST /api/auth/2fa-enroll {preAuthToken,action:"enroll"|"verify",code?}
import { api } from "./client";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
  twoFactorEnabled?: boolean;
  [key: string]: unknown;
}

export type LoginResult = {
  token?: string;
  requires2FA?: boolean;
  mustEnroll2FA?: boolean;
  preAuthToken?: string;
  user?: AuthUser;
};

export async function login(email: string, password: string, totpCode?: string): Promise<LoginResult> {
  return api.post<LoginResult>("/api/auth/login", {
    email,
    password,
    ...(totpCode ? { totpCode } : {}),
  });
}

export async function register(
  name: string,
  email: string,
  password: string
): Promise<{ user?: AuthUser; token?: string; needsVerification?: boolean; demoVerifyUrl?: string }> {
  return api.post("/api/auth/register", { name, email, password });
}

export async function verifyEmail(token: string): Promise<{ ok?: boolean; email?: string }> {
  return api.post("/api/auth/verify-email", { token });
}

export async function resendVerification(
  email: string
): Promise<{ ok?: boolean; demoVerifyUrl?: string }> {
  return api.post("/api/auth/verify-email/resend", { email });
}

export async function forgotPassword(
  email: string
): Promise<{ ok?: boolean; demoResetUrl?: string }> {
  return api.post("/api/auth/forgot-password", { email });
}

export async function resetPassword(token: string, password: string): Promise<{ ok?: boolean }> {
  return api.post("/api/auth/reset-password", { token, password });
}

export type EnrollSetup = { secret: string; qrCodeDataUrl: string; backupCodes: string[] };

export async function enroll2fa(
  preAuthToken: string,
  action: "enroll" | "verify",
  code?: string
): Promise<(EnrollSetup & { action?: string; enabled?: boolean; user?: AuthUser; token?: string }) | null> {
  return api.post("/api/auth/2fa-enroll", {
    preAuthToken,
    action,
    ...(code ? { code } : {}),
  });
}

/** 已配置的 OAuth 提供方（P3-2，Auth.js GET /api/auth/providers）。 */
export async function fetchOAuthProviders(): Promise<string[]> {
  try {
    const p = await api.get<Record<string, unknown>>("/api/auth/providers");
    return Object.keys(p ?? {});
  } catch {
    return [];
  }
}

/** 登录态探测（登录/注册页用于把已登录用户送回工作台）。 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const d = await api.get<{ user?: AuthUser }>("/api/auth/me");
    return d?.user ?? null;
  } catch {
    return null;
  }
}
