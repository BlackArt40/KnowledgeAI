// Shared helpers for the integration suites (tests/{functional,api,performance}).
// P7-5: single source of truth for demo-account login + authenticated requests -
// session mechanics or demo credentials only need to change here, not in every suite.
// Usage: import { login, api, BASE, AUTH } from "./helpers.mjs";
//   await login();                       // owner@knowledgeai.dev / password123
//   await api("/api/...", { method, headers, body });

const rawBase = process.env.KAI_TEST_BASE || "http://localhost:3000";
export const BASE = rawBase.replace(/\/+$/, "");

/** Current session cookie (read-only live binding - mutate via login()). */
export let AUTH = null;

/** Log in with a demo account and store the kai-token cookie for api(). */
export async function login(email = "owner@knowledgeai.dev", password = "password123") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (data.token) AUTH = { Cookie: `kai-token=${data.token}` };
  return !!data.token;
}

/** Authenticated request helper: merges the session cookie into every call. */
export function api(path, opts = {}) {
  const headers = { ...(AUTH || {}), ...(opts.headers || {}) };
  return fetch(`${BASE}${path}`, { ...opts, headers });
}
