// @ts-nocheck
// P3-1 HTTP integration test: full login -> 2FA -> session flow against a live dev server.
// Run: npx tsx scripts/smoke/test-2fa-http.ts   (requires `pnpm dev` running on :3000)
import { generateTOTP } from "../../src/lib/security/totp";

const BASE = "http://localhost:3000";
let failures = 0;
const results: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) results.push(`✅ ${name}`);
  else { results.push(`❌ ${name} ${detail}`); failures++; }
}

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function patch(path: string, body: unknown, token: string) {
  const res = await fetch(BASE + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const email = "admin@knowledgeai.dev";
  const password = "password123";

  // 1. Login as admin (no policy yet) -> session token
  let r = await post("/api/auth/login", { email, password });
  check("http: admin login (no 2FA) -> token", r.status === 200 && !!r.data.token, JSON.stringify(r.data));
  const adminToken = r.data.token;

  // 2. Set required2FARoles = [admin]
  const pc = await patch("/api/admin/config", { required2FARoles: ["admin"] }, adminToken);
  check("http: set 2FA policy for admin role", pc.status === 200, JSON.stringify(pc.data));
  check("http: policy persisted", Array.isArray(pc.data?.config?.required2FARoles) && pc.data.config.required2FARoles.includes("admin"), JSON.stringify(pc.data?.config));

  // 3. Fresh login attempt (password only) -> mustEnroll2FA + preAuthToken
  r = await post("/api/auth/login", { email, password });
  check("http: login returns mustEnroll2FA", r.data.mustEnroll2FA === true, JSON.stringify(r.data));
  check("http: preAuthToken issued", !!r.data.preAuthToken);
  const preAuthToken = r.data.preAuthToken;

  // 4. Forced enroll with preAuthToken -> secret + qr + backup codes
  r = await post("/api/auth/2fa-enroll", { preAuthToken, action: "enroll" });
  check("http: forced enroll returns secret", r.status === 200 && !!r.data.secret, JSON.stringify(r.data));
  check("http: forced enroll returns qrCodeDataUrl", !!r.data.qrCodeDataUrl && r.data.qrCodeDataUrl.startsWith("data:image/"));
  check("http: forced enroll returns 8 backup codes", Array.isArray(r.data.backupCodes) && r.data.backupCodes.length === 8);
  const secret = r.data.secret;

  // 5. Verify enrollment -> session token issued (login completes)
  const code = generateTOTP(secret, Date.now());
  r = await post("/api/auth/2fa-enroll", { preAuthToken, action: "verify", code });
  check("http: enroll verify -> enabled", r.data.enabled === true, JSON.stringify(r.data));
  check("http: enroll verify -> session token", !!r.data.token);
  const newToken = r.data.token;

  // 6. Now 2FA is enabled. Login (password only) -> requires2FA
  r = await post("/api/auth/login", { email, password });
  check("http: login returns requires2FA", r.data.requires2FA === true, JSON.stringify(r.data));

  // 7. Login with correct TOTP -> token
  const loginCode = generateTOTP(secret, Date.now());
  r = await post("/api/auth/login", { email, password, totpCode: loginCode });
  check("http: login with TOTP -> token", r.status === 200 && !!r.data.token, JSON.stringify(r.data));

  // 8. Login with wrong TOTP -> 401
  r = await post("/api/auth/login", { email, password, totpCode: "000000" });
  check("http: login with wrong TOTP -> 401", r.status === 401, JSON.stringify(r.data));

  // 9. Settings-based enrollment via /api/security/2fa (authenticated) for the viewer account
  const vLogin = await post("/api/auth/login", { email: "viewer@knowledgeai.dev", password });
  const viewerToken = vLogin.data.token;
  const e2 = await post("/api/security/2fa", { action: "enroll" }, viewerToken);
  check("http: settings enroll returns qrCodeDataUrl", !!e2.data.qrCodeDataUrl && e2.data.qrCodeDataUrl.startsWith("data:image/"), JSON.stringify(e2.data));
  const v2 = await post("/api/security/2fa", { action: "verify", code: generateTOTP(e2.data.secret, Date.now()) }, viewerToken);
  check("http: settings verify -> enabled", v2.data.enabled === true, JSON.stringify(v2.data));
  // getSecurity should not leak hashed backup codes
  const sec = await fetch(BASE + "/api/security", { headers: { authorization: `Bearer ${viewerToken}` } }).then((x) => x.json());
  check("http: getSecurity shows enabled", sec.twoFactor?.enabled === true);
  check("http: getSecurity backupCodes sanitized (empty)", Array.isArray(sec.twoFactor?.backupCodes) && sec.twoFactor.backupCodes.length === 0);
  check("http: getSecurity backupCodesRemaining = 8", sec.twoFactor?.backupCodesRemaining === 8, `got ${sec.twoFactor?.backupCodesRemaining}`);

  // 10. Reset policy
  await patch("/api/admin/config", { required2FARoles: [] }, newToken);

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`} (${results.length} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
