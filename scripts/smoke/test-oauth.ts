// @ts-nocheck
// P3-2 acceptance verification: OAuth social login (Google / GitHub) via
// Auth.js v5 + bridge, against a mock OAuth authorization server.
//
// The test:
//   1. Starts a mock OAuth provider (authorize / token / userinfo) on :5092.
//   2. Spawns a :3100 production instance with GOOGLE_*/GITHUB_* client ids
//      and endpoint overrides pointing at the mock (same pattern as
//      test-integrations.ts / test-health.ts).
//   3. Walks the full dance with a cookie jar:
//      signin -> provider authorize (state + PKCE) -> callback -> bridge
//      (mints kai-token) -> /dashboard, then verifies account creation,
//      email linking, bind mode, unbind + audit.
//
// Run: npx tsx scripts/smoke/test-oauth.ts   (requires `pnpm dev` on :3000
//      as the unconfigured reference; a prod build for :3100)

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MOCK_PORT = 5092;
const BASE = "http://localhost:3000";
let failures = 0;
const results: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) results.push(`✅ ${name}`);
  else { results.push(`❌ ${name} ${detail}`); failures++; }
}

// ── Mock OAuth provider ────────────────────────────────────────────────────
// OIDC discovery (/.well-known/openid-configuration) + jwks + authorize +
// token (id_token signed RS256 for the OIDC Google flow) + userinfo.
// Auth.js points its ISSUER at this server; all endpoints come from the
// discovery document. profilePool: each entry becomes one provider account,
// served by userinfo keyed by the access token (= the code). Set before each
// flow.
const profilePool = [];
let codeCounter = 0;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const KID = "mock-rsa-1";

function signIdToken(sub: string, email: string, clientId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ iss: `http://127.0.0.1:${MOCK_PORT}`, aud: clientId, sub, email, iat: now, exp: now + 3600 })
  ).toString("base64url");
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function startMockProvider() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
      const respondJson = (obj, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
        respondJson({
          issuer: `http://127.0.0.1:${MOCK_PORT}`,
          authorization_endpoint: `http://127.0.0.1:${MOCK_PORT}/authorize`,
          token_endpoint: `http://127.0.0.1:${MOCK_PORT}/token`,
          userinfo_endpoint: `http://127.0.0.1:${MOCK_PORT}/userinfo`,
          jwks_uri: `http://127.0.0.1:${MOCK_PORT}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/jwks") {
        respondJson({ keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] });
        return;
      }
      if (req.method === "GET" && url.pathname === "/authorize") {
        // Authorization endpoint: echo back whatever state Auth.js sent
        // (Google checks = pkce only, GitHub = state + pkce) with a code.
        const code = `mock-code-${++codeCounter}`;
        const state = url.searchParams.get("state");
        const redirect = `${url.searchParams.get("redirect_uri")}?code=${code}${state ? `&state=${state}` : ""}`;
        res.writeHead(302, { Location: redirect });
        res.end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/token") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const params = new URLSearchParams(body);
          const code = params.get("code");
          const idx = parseInt(String(code).replace("mock-code-", ""), 10) - 1;
          const profile = profilePool[idx] ?? { sub: "sub-unknown", name: "?", email: "?@example.com" };
          // client_id: body (client_secret_post) or Basic auth user
          // (client_secret_basic - GitHub's default client auth).
          let clientId = params.get("client_id") ?? "";
          if (!clientId && req.headers.authorization?.startsWith("Basic ")) {
            clientId = Buffer.from(req.headers.authorization.slice(6), "base64").toString("utf8").split(":")[0];
          }
          respondJson({
            access_token: code,
            id_token: signIdToken(profile.sub, profile.email, clientId || "test-google-client"),
            token_type: "Bearer",
            expires_in: 3600,
            scope: params.get("scope") || "openid email profile",
          });
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/userinfo") {
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        const idx = parseInt(String(token).replace("mock-code-", ""), 10) - 1;
        const profile = profilePool[idx];
        if (!profile) return respondJson({ error: "invalid_token" }, 401);
        return respondJson(profile);
      }
      respondJson({ error: "not_found" }, 404);
    });
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ── :3100 production instance (OAuth-configured) ───────────────────────────
async function spawnConfiguredServer(): Promise<{ server: ReturnType<typeof spawn>; url: string; ready: () => Promise<boolean> }> {
  const env = {
    ...process.env,
    DATABASE_URL: "",
    REDIS_URL: "",
    // .env.local pins NEXTAUTH_URL to :3000 - the :3100 instance must use
    // its own origin for Auth.js baseUrl / redirect_uri.
    NEXTAUTH_URL: "",
    AUTH_URL: "http://localhost:3100",
    // High rate limits: the OAuth dance makes many requests per flow.
    RATE_LIMIT_PER_MIN: "2000",
    RATE_LIMIT_ANON_PER_MIN: "500",
    RATE_LIMIT_KEY_PER_MIN: "5000",
    RATE_LIMIT_KB_PER_MIN: "1000",
    GOOGLE_CLIENT_ID: "test-google-client",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    GOOGLE_ISSUER: `http://127.0.0.1:${MOCK_PORT}`,
    GITHUB_CLIENT_ID: "test-github-client",
    GITHUB_CLIENT_SECRET: "test-github-secret",
    GITHUB_ISSUER: `http://127.0.0.1:${MOCK_PORT}`,
  };
  const server = spawn("pnpm", ["start", "-p", "3100"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Capture the instance log for debugging auth errors.
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  (server as unknown as { __log: () => string }).__log = () => log;
  const url = "http://localhost:3100";
  const ready = () =>
    new Promise<boolean>((resolveReady) => {
      const deadline = Date.now() + 60_000;
      const tick = async () => {
        if (Date.now() > deadline) return resolveReady(false);
        try {
          const r = await fetch(`${url}/api/health`);
          if (r.ok) return resolveReady(true);
        } catch { /* not up yet */ }
        setTimeout(tick, 1000);
      };
      tick();
    });
  return { server, url, ready };
}

// ── Cookie jar helper ───────────────────────────────────────────────────────
function makeJar(base: string) {
  const cookies = new Map<string, string>();
  return {
    async req(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; redirect?: "manual" | "follow" } = {}) {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (cookies.size) headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      if (opts.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const body =
        opts.body instanceof URLSearchParams
          ? opts.body
          : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined;
      const res = await fetch(`${path.startsWith("http") ? "" : base}${path}`, {
        method,
        headers,
        body,
        redirect: opts.redirect ?? "manual",
      });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      return res;
    },
    cookies,
  };
}

// Auth.js v5 OAuth kickoff: GET signin is unsupported - POST with a CSRF
// token (the same flow the oauthSignIn client helper uses).
async function oauthStart(jar: ReturnType<typeof makeJar>, provider: string, callbackUrl = "/api/auth/oauth/bridge") {
  const csrf = await (await jar.req("GET", "/api/auth/csrf")).json();
  return jar.req("POST", `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(callbackUrl)}`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken ?? "" }),
  });
}

/** Full dance: signin -> (mock) authorize -> Auth.js callback -> bridge.
 *  Follows the 302 chain (max 8 hops) so the final response is the bridge's
 *  (302 /dashboard + kai-token cookie, captured by the jar). */
async function completeOAuth(jar: ReturnType<typeof makeJar>, provider: string, callbackUrl = "/api/auth/oauth/bridge") {
  let res = await oauthStart(jar, provider, callbackUrl);
  const hops: string[] = [`${res.status} ${res.headers.get("location") ?? ""}`];
  for (let i = 0; i < 8; i++) {
    const loc = res.headers.get("location");
    if (res.status !== 302 || !loc) break;
    if (loc.includes("/dashboard") || loc.includes("/login")) break; // final
    res = await jar.req("GET", loc);
    hops.push(`${res.status} ${res.headers.get("location") ?? ""}`);
  }
  (jar as unknown as { __hops: string[] }).__hops = hops;
  return res;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n── 0. 未配置实例（:3000 dev，无 OAuth env）──");
  const ref = makeJar(BASE);
  const noCfg = await ref.req("GET", "/api/auth/signin/google");
  check("未配置 signin -> 重定向回 /login", noCfg.status === 302 && String(noCfg.headers.get("location")).startsWith(`${BASE}/login`), String(noCfg.headers.get("location")));
  const providers = await (await fetch(`${BASE}/api/auth/providers`)).json();
  check("未配置 /api/auth/providers 为空", Object.keys(providers).length === 0, JSON.stringify(providers));

  console.log("\n── mock OAuth provider + :3100 配置实例 ──");
  const mock = await startMockProvider();
  const { server, url, ready } = await spawnConfiguredServer();
  check(":3100 实例就绪", await ready());
  if (!(await ready())) {
    server.kill("SIGTERM"); mock.close(); console.log("\n❌ :3100 未就绪，中止"); process.exit(1);
  }
  const cfgProviders = await (await fetch(`${url}/api/auth/providers`)).json();
  check(":3100 /api/auth/providers 含 google+github", Object.keys(cfgProviders).sort().join(",") === "github,google", JSON.stringify(cfgProviders));

  // ── 1. 自动建号登录（新邮箱） ───────────────────────────────────────
  console.log("\n── 1. 自动建号（新邮箱）──");
  profilePool.push({ sub: "sub-1001", id: 1001, name: "OAuth 新用户", email: "oauth.new@example.com", picture: null });
  const jar1 = makeJar(url);
  const s1 = await oauthStart(jar1, "google");
  check("signin google 302 -> provider authorize", s1.status === 302 && !!s1.headers.get("location"), `${s1.status} ${s1.headers.get("location")}`);
  const authUrl = new URL(s1.headers.get("location"));
  // Google's Auth.js checks default to ["pkce"] (no state) - verify PKCE
  // challenge + client_id; the GitHub flow below asserts the state param.
  check("authorize URL 含 PKCE(S256) + client_id", !!authUrl.searchParams.get("code_challenge") && authUrl.searchParams.get("code_challenge_method") === "S256" && authUrl.searchParams.get("client_id") === "test-google-client", authUrl.searchParams.toString().slice(0, 160));
  check("redirect_uri 指向 callback", String(authUrl.searchParams.get("redirect_uri")).includes("/api/auth/callback/google"), String(authUrl.searchParams.get("redirect_uri")));

  const b1 = await completeOAuth(jar1, "google");
  if (b1.status !== 302) {
    console.log("HOPS:", (jar1 as unknown as { __hops: string[] }).__hops.join(" -> "));
    const l = (server as unknown as { __log: () => string }).__log();
    fs.writeFileSync("/tmp/oauth-server.log", l);
    console.log("SERVER LOG written: /tmp/oauth-server.log", l.length, "chars");
  }
  check("bridge 重定向 -> /dashboard", [302, 307].includes(b1.status) && String(b1.headers.get("location")).endsWith("/dashboard"), `${b1.status} ${b1.headers.get("location")}`);
  check("bridge 设置 kai-token cookie", jar1.cookies.has("kai-token"));
  const me1 = await (await jar1.req("GET", "/api/auth/me")).json();
  check("自动建号: me.email = OAuth 邮箱", me1.user?.email === "oauth.new@example.com", JSON.stringify(me1.user?.email));
  check("自动建号: oauthLinks.google 已记录", me1.user?.oauthLinks?.google === "sub-1001", JSON.stringify(me1.user?.oauthLinks));
  const newUserId = me1.user?.id;
  check("自动建号: 有 userId", !!newUserId);

  // 再次登录同一 provider -> 同一账号
  profilePool.push({ sub: "sub-1001", id: 1001, name: "OAuth 新用户", email: "oauth.new@example.com", picture: null });
  const jar1b = makeJar(url);
  await completeOAuth(jar1b, "google");
  const me1b = await (await jar1b.req("GET", "/api/auth/me")).json();
  check("重复登录 -> 同一 userId（provider 关联生效）", !!me1b.user && me1b.user.id === newUserId, `${me1b.user?.id} vs ${newUserId}`);

  // ── 2. 邮箱关联（已有账号首次 OAuth 登录） ─────────────────────────
  console.log("\n── 2. 邮箱关联 ──");
  const regJar = makeJar(url);
  const reg = await regJar.req("POST", "/api/auth/register", { body: { name: "同名用户", email: "oauth.link@example.com", password: "password123" } });
  check("预注册同邮箱账号", reg.status === 200 || reg.status === 201, String(reg.status));
  const regUserId = (await reg.json()).user?.id;

  profilePool.push({ sub: "sub-2002", id: 2002, name: "同名用户", email: "oauth.link@example.com", picture: null });
  const jar2 = makeJar(url);
  const s2start = await oauthStart(jar2, "github");
  // GitHub's Auth.js checks default to ["pkce"] too (checks = pkce only) -
  // verify the authorize URL goes to the MOCK issuer (not github.com) with
  // PKCE challenge + our client id.
  const ghAuthUrl = s2start.status === 302 ? new URL(s2start.headers.get("location")) : null;
  check("github authorize URL 走 mock issuer（非 github.com）", !!ghAuthUrl && ghAuthUrl.host === `127.0.0.1:${MOCK_PORT}`, ghAuthUrl?.toString().slice(0, 160) ?? String(s2start.status));
  check("github authorize URL 含 PKCE(S256) + client_id", !!ghAuthUrl && !!ghAuthUrl.searchParams.get("code_challenge") && ghAuthUrl.searchParams.get("code_challenge_method") === "S256" && ghAuthUrl.searchParams.get("client_id") === "test-github-client", ghAuthUrl?.searchParams.toString().slice(0, 160) ?? String(s2start.status));
  await completeOAuth(jar2, "github");
  const me2 = await (await jar2.req("GET", "/api/auth/me")).json();
  check("邮箱关联: 登录后为同一 userId", me2.user?.id === regUserId, `${me2.user?.id} vs ${regUserId}`);
  check("邮箱关联: oauthLinks.github 已绑定", me2.user?.oauthLinks?.github === "2002", JSON.stringify(me2.user?.oauthLinks));

  // ── 3. 绑定模式（已登录 -> 绑定新 provider，会话不变） ─────────────
  console.log("\n── 3. 绑定模式 ──");
  const ownerJar = makeJar(url);
  const login = await ownerJar.req("POST", "/api/auth/login", { body: { email: "owner@knowledgeai.dev", password: "password123" } });
  check("owner 密码登录", login.status === 200, String(login.status));
  const ownerId = (await login.json()).user?.id;

  profilePool.push({ sub: "sub-3003", id: 3003, name: "张明（Owner）", email: "owner@knowledgeai.dev", picture: null });
  const b3 = await completeOAuth(ownerJar, "github", "/api/auth/oauth/bridge?cb=%2Fsettings%3Ftab%3Dsecurity");
  check("绑定模式: 重定向回 /settings?tab=security", [302, 307].includes(b3.status) && String(b3.headers.get("location")).includes("/settings?tab=security"), `${b3.status} ${b3.headers.get("location")}`);
  const me3 = await (await ownerJar.req("GET", "/api/auth/me")).json();
  check("绑定模式: 仍是 owner 账号", me3.user?.id === ownerId, `${me3.user?.id} vs ${ownerId}`);
  check("绑定模式: oauthLinks.github = 3003", me3.user?.oauthLinks?.github === "3003", JSON.stringify(me3.user?.oauthLinks));

  // ── 4. 解绑 ────────────────────────────────────────────────────────
  console.log("\n── 4. 解绑 ──");
  const del = await ownerJar.req("DELETE", "/api/auth/oauth/link?provider=github");
  const delData = await del.clone().json();
  check("解绑 200 + oauthLinks 移除 github", del.status === 200 && !delData.oauthLinks?.github, `${del.status} ${JSON.stringify(delData)}`);
  const audit = await (await ownerJar.req("GET", "/api/admin/audit?action=auth.oauth_unlink")).json();
  check("审计 auth.oauth_unlink 可查", (audit.audit ?? []).length >= 1, JSON.stringify(audit.audit?.length));

  // 最后一登录方式拒绝：OAuth-only 用户解绑唯一 provider -> 400
  profilePool.push({ sub: "sub-4004", id: 4004, name: "仅 OAuth", email: "only.oauth@example.com", picture: null });
  const jar4 = makeJar(url);
  await completeOAuth(jar4, "google");
  const delLast = await jar4.req("DELETE", "/api/auth/oauth/link?provider=google");
  check("OAuth-only 用户解绑唯一方式 -> 400", delLast.status === 400, String(delLast.status));
  const delBad = await jar4.req("DELETE", "/api/auth/oauth/link?provider=wechat");
  check("未知 provider 解绑 -> 400", delBad.status === 400, String(delBad.status));
  const delAnon = await makeJar(url).req("DELETE", "/api/auth/oauth/link?provider=google");
  check("匿名解绑 -> 401", delAnon.status === 401, String(delAnon.status));

  // ── 5. 审计 oauth_login_success ────────────────────────────────────
  console.log("\n── 5. 审计 ──");
  const auditLogin = await (await ownerJar.req("GET", "/api/admin/audit?action=auth.oauth_login_success")).json();
  check("审计 auth.oauth_login_success ≥1", (auditLogin.audit ?? []).length >= 1, JSON.stringify(auditLogin.audit?.length));

  server.kill("SIGTERM");
  mock.close();
  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ OAuth acceptance: ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
