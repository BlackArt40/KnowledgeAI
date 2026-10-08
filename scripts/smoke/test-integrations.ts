// @ts-nocheck
// P7-2 acceptance verification: integrations.
//   1. Embeddable widget - kai-widget.js + demo.html served; file is
//      self-contained (no import/require); CORS on the v1 API (F17: denied on
//      a production instance without an allowlist, reflected for a listed
//      Origin on the :3100 instance that has one)
//   2. Chat bots - create bindings per platform; callbacks answer in the
//      platform format; Slack/Feishu url_verification challenges echo; bad
//      token 401; deleted bot 404
//   3. Integration rate limiting - a low-limit server on :3100 proves the
//      integration tier 429s independently (second `next start` instance,
//      same pattern as test-health.ts)
//   4. Chrome extension - manifest valid + referenced files exist
// Run: npx tsx scripts/smoke/test-integrations.ts   (requires `pnpm dev`)

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSmokeBase } from "./lib/base-url";
import { DEMO_PASSWORD } from "./lib/demo";
import { demoAuthSecret } from "./lib/demo-env";
import { DETACHED, killTree, assertPortFree } from "./lib/proc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Local-only origin (validated port, no other URL component honored).
const BASE = resolveSmokeBase();
/** Origin used for the CORS assertions (F17). The :3100 instance is spawned
 *  with exactly this value in CORS_ALLOWED_ORIGINS. */
const CORS_ALLOWED_ORIGIN = "https://example-widget-site.com";
const CORS_OTHER_ORIGIN = "https://not-on-the-allowlist.example.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  const req = async (method, path, opts = {}) => {
    const headers = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.origin) headers.Origin = opts.origin;
    if (opts.xPlatform) headers["X-Kai-Platform"] = opts.xPlatform;
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  };

  const login = await req("POST", "/api/auth/login", {
    body: { email: "owner@knowledgeai.dev", password: DEMO_PASSWORD },
  });
  const token = login.data?.token;
  check("login: owner token", !!token);
  const kbs = await req("GET", "/api/v1/knowledge-bases", { token });
  const kbId = kbs.data?.kbs?.[0]?.id;
  check("setup: kbId", !!kbId);

  // ── 1. Embeddable widget ─────────────────────────────────────────────
  console.log("\n── 1. Embeddable Widget ──");
  const widget = await fetch(`${BASE}/widget/kai-widget.js`);
  const widgetText = await widget.text();
  check("widget.js: 200", widget.status === 200, `status=${widget.status}`);
  check("widget.js: has init API", widgetText.includes("KnowledgeAIWidget.init"), "missing init");
  check("widget.js: self-contained (no imports)", !/import\s|require\(|from\s+["']/.test(widgetText));
  const demo = await fetch(`${BASE}/widget/demo.html`);
  check("widget demo.html: 200", demo.status === 200, `status=${demo.status}`);

  // CORS for the widget's cross-origin chat call.
  // F17 (2026-09-30): with CORS_ALLOWED_ORIGINS unset, reflection is now a
  // dev-only convenience. The smoke-infra job runs this against a PRODUCTION
  // `next start` instance, so the correct expectation here is DENY: no
  // Access-Control-Allow-Origin header at all (the browser then blocks the
  // request). The allowlist-hit path is asserted further down against the
  // :3100 instance, which is spawned with an explicit allowlist.
  const cors = await req("POST", "/api/v1/chat", {
    origin: "https://example-widget-site.com",
    token,
    body: { kbId, query: "测试 CORS" },
  });
  check(
    "v1 chat CORS (prod, no allowlist): origin NOT reflected",
    !cors.headers?.get?.("access-control-allow-origin"),
    String(cors.headers?.get?.("access-control-allow-origin"))
  );
  check(
    "v1 chat CORS: Vary: Origin still sent",
    String(cors.headers?.get?.("vary") ?? "").includes("Origin"),
    String(cors.headers?.get?.("vary"))
  );
  const preflight = await fetch(`${BASE}/api/v1/chat`, {
    method: "OPTIONS",
    headers: { Origin: "https://example-widget-site.com", "Access-Control-Request-Method": "POST" },
  });
  check(
    "v1 chat CORS preflight: 204 without allow-methods (denied)",
    preflight.status === 204 && !preflight.headers.get("access-control-allow-methods"),
    `status=${preflight.status} allow-methods=${preflight.headers.get("access-control-allow-methods")}`
  );

  // ── 2. Chat bots ─────────────────────────────────────────────────────
  console.log("\n── 2. 群机器人 ──");
  const badToken = await req("POST", "/api/v1/integrations/bot/m/kai_bot_000000000000000000000000000000000000", {
    body: { text: "hi" },
  });
  check("bot callback with bad token: 401", badToken.status === 401, `status=${badToken.status}`);

  const created = await req("POST", "/api/v1/integrations/bot", {
    token,
    body: { name: "验收机器人", platform: "test", kbId },
  });
  const botToken = created.data?.bot?.token;
  const botId = created.data?.bot?.id;
  check("create bot: 201 + token", created.status === 201 && !!botToken && botToken.startsWith("kai_bot_"), JSON.stringify(created.data).slice(0, 150));
  check("list bots: includes binding", (await req("GET", "/api/v1/integrations/bot", { token })).data?.bots?.some((b) => b.id === botId));
  check("list bots: no tokenHash/secret leak", !JSON.stringify((await req("GET", "/api/v1/integrations/bot", { token })).data).includes(botToken));

  // test platform: raw { answer, citations }
  const answer = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, { body: { text: "你好" } });
  check("bot (test) answers: 200 + text", answer.status === 200 && typeof answer.data?.answer === "string" && answer.data.answer.length > 0, JSON.stringify(answer.data).slice(0, 150));

  // platform format verification (slack/feishu/dingtalk parse + reply shapes)
  const slackChallenge = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, {
    body: { type: "url_verification", challenge: "slack-verify-1" },
    xPlatform: "slack",
  });
  check("bot: slack challenge echoes", slackChallenge.status === 200 && slackChallenge.data?.challenge === "slack-verify-1", JSON.stringify(slackChallenge.data));
  const slackReply = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, { body: { text: "你好" }, xPlatform: "slack" });
  check("bot: slack reply format", typeof slackReply.data?.text === "string" && slackReply.data.text.length > 0, JSON.stringify(slackReply.data).slice(0, 120));
  const feishuReply = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, {
    body: { event: { message: { content: JSON.stringify({ text: "你好" }) } } },
    xPlatform: "feishu",
  });
  check("bot: feishu reply format", feishuReply.data?.msg_type === "text" && typeof feishuReply.data?.content?.text === "string", JSON.stringify(feishuReply.data).slice(0, 120));
  const dingReply = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, {
    body: { msgtype: "text", text: { content: "你好" } },
    xPlatform: "dingtalk",
  });
  check("bot: dingtalk reply format", dingReply.data?.msgtype === "text" && typeof dingReply.data?.text?.content === "string", JSON.stringify(dingReply.data).slice(0, 120));

  // empty message -> hint reply
  const emptyReply = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, { body: {} });
  check("bot: empty message gets hint", typeof emptyReply.data?.answer === "string", JSON.stringify(emptyReply.data).slice(0, 100));

  // toggle off -> callback 401
  await req("PATCH", `/api/v1/integrations/bot/${botId}`, { token, body: { active: false } });
  const disabled = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, { body: { text: "hi" } });
  check("bot: disabled binding rejected", disabled.status === 401, `status=${disabled.status}`);
  await req("PATCH", `/api/v1/integrations/bot/${botId}`, { token, body: { active: true } });

  // delete -> 404 + callback 401
  const del = await req("DELETE", `/api/v1/integrations/bot/${botId}`, { token });
  check("bot delete: 200", del.status === 200 && del.data?.ok === true, `status=${del.status}`);
  const afterDel = await req("POST", `/api/v1/integrations/bot/m/${botToken}`, { body: { text: "hi" } });
  check("bot callback after delete: 401", afterDel.status === 401, `status=${afterDel.status}`);

  // ── 3. 独立认证与限流（integration 档 429）──────────────────────────
  console.log("\n── 3. 集成独立限流 (integration tier) ──");
  // 起一个低限额的 :3100 生产实例（Next dev 有目录锁，沿用 test-health 模式）
  const buildNeeded = !existsSync(join(ROOT, ".next", "BUILD_ID"));
  if (buildNeeded) {
    console.log("  (building production bundle first - takes a moment)");
    const { execSync } = await import("node:child_process");
    execSync("pnpm build", { cwd: ROOT, stdio: "inherit", timeout: 600_000 });
  }
  // A previous infra script that leaked its own :3100 instance would silently
  // answer these requests with the wrong env (e.g. no NOTION_API_URL), so
  // refuse to start rather than hang on a foreign server.
  if (!(await assertPortFree(3100, console.error))) process.exit(1);
  const server = spawn("pnpm", ["start", "-p", "3100"], {
    cwd: ROOT,
    env: {
      ...process.env,
      AUTH_SECRET: demoAuthSecret(),
      DATABASE_URL: "",
      REDIS_URL: "",
      RATE_LIMIT_INTEGRATION_PER_MIN: "3",
      // F17: the allowlist-hit CORS path can only be observed on a server that
      // actually has an allowlist configured (the main :3000 instance is
      // production without one, and must stay denied).
      CORS_ALLOWED_ORIGINS: CORS_ALLOWED_ORIGIN,
    },
    stdio: ["ignore", "ignore", "pipe"],
    ...DETACHED,
  });
  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch("http://localhost:3100/api/health");
        if (r.ok) { up = true; break; }
      } catch {}
      await sleep(1000);
    }
    check(":3100 production instance up", up);

    // ── F17: the allowlist-hit CORS path (only observable with a configured
    // allowlist). Same production mode as :3000, but CORS_ALLOWED_ORIGINS is
    // set, so a listed Origin IS reflected and an unlisted one is not.
    const corsListed = await fetch("http://localhost:3100/api/health", {
      headers: { Origin: CORS_ALLOWED_ORIGIN },
    });
    check(
      "F17 CORS: listed origin reflected",
      corsListed.headers.get("access-control-allow-origin") === CORS_ALLOWED_ORIGIN,
      String(corsListed.headers.get("access-control-allow-origin"))
    );
    const corsListedPreflight = await fetch("http://localhost:3100/api/v1/knowledge-bases", {
      method: "OPTIONS",
      headers: { Origin: CORS_ALLOWED_ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    check(
      "F17 CORS: preflight 204 + allow-methods for listed origin",
      corsListedPreflight.status === 204 &&
        String(corsListedPreflight.headers.get("access-control-allow-methods") ?? "").includes("GET"),
      `status=${corsListedPreflight.status} allow-methods=${corsListedPreflight.headers.get("access-control-allow-methods")}`
    );
    const corsUnlisted = await fetch("http://localhost:3100/api/health", {
      headers: { Origin: CORS_OTHER_ORIGIN },
    });
    check(
      "F17 CORS: unlisted origin NOT reflected (no allowlist fallback)",
      !corsUnlisted.headers.get("access-control-allow-origin"),
      String(corsUnlisted.headers.get("access-control-allow-origin"))
    );

    const login3100 = await fetch("http://localhost:3100/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@knowledgeai.dev", password: DEMO_PASSWORD }),
    }).then((r) => r.json());
    const kbs3100 = await fetch("http://localhost:3100/api/v1/knowledge-bases", {
      headers: { Authorization: `Bearer ${login3100.token}` },
    }).then((r) => r.json());
    const kb3100 = kbs3100.kbs?.[0]?.id;
    const bot3100 = await fetch("http://localhost:3100/api/v1/integrations/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login3100.token}` },
      body: JSON.stringify({ name: "限流机器人", platform: "test", kbId: kb3100 }),
    }).then((r) => r.json());
    const t3100 = bot3100.bot.token;

    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`http://localhost:3100/api/v1/integrations/bot/m/${t3100}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "测试" }),
      });
      statuses.push(r.status);
    }
    check("integration tier: 429 after limit (limit=3)", statuses.filter((s) => s === 429).length >= 1, `statuses=${statuses.join(",")}`);
    check("integration tier: first requests still served", statuses.slice(0, 3).every((s) => s === 200), `statuses=${statuses.join(",")}`);

    // 同一属主的普通 API 不受影响（apikey 档独立）
    const ownerApi = await fetch("http://localhost:3100/api/v1/me", {
      headers: { Authorization: `Bearer ${login3100.token}` },
    });
    check("integration tier: owner quota untouched", ownerApi.status === 200, `status=${ownerApi.status}`);
  } finally {
    killTree(server);
  }

  // ── 4. Chrome 扩展 ───────────────────────────────────────────────────
  console.log("\n── 4. Chrome 扩展 ──");
  const extDir = join(ROOT, "integrations", "chrome-extension");
  const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf-8"));
  check("extension manifest: MV3", manifest.manifest_version === 3, String(manifest.manifest_version));
  check("extension manifest: background service_worker", manifest.background?.service_worker === "background.js");
  const refs = [
    manifest.background?.service_worker,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
  ].filter(Boolean);
  const missing = refs.filter((f) => !existsSync(join(extDir, f)));
  check("extension manifest: all referenced files exist", missing.length === 0, `missing=${missing.join(",")}`);
  check("extension: background + result + options js present", ["background.js", "result.js", "options.js"].every((f) => existsSync(join(extDir, f))));
  check("extension: README present", existsSync(join(extDir, "README.md")));

  // ── 5. 汇总 ──────────────────────────────────────────────────────────
  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅" : "❌"} integrations smoke: ${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
