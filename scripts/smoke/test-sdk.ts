// @ts-nocheck
// P7-1 acceptance verification: three official SDKs (JavaScript / Python / Go)
// work against a live dev server - login -> create API key -> exercise the v1
// surface through each SDK (me / list KBs / chat SSE / agent run / webhooks).
//
// Run: npx tsx scripts/smoke/test-sdk.ts   (requires `pnpm dev` + node/python3/go)

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSmokeBase } from "./lib/base-url";
import { DEMO_PASSWORD } from "./lib/demo";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = resolveSmokeBase();

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
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };

  // ── 0. 准备: 登录 + API key ──────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const login = await req("POST", "/api/auth/login", {
    body: { email: "owner@knowledgeai.dev", password: DEMO_PASSWORD },
  });
  const token = login.data?.token;
  check("login: owner token", !!token);

  const keyRes = await req("POST", "/api/api-keys", {
    token,
    body: { name: "sdk-test", scopes: ["kb:read", "kb:write", "chat:read", "agent:run"] },
  });
  const apiKey = keyRes.data?.key?.secret;
  check("create api key", !!apiKey);

  const kbs = await req("GET", "/api/v1/knowledge-bases", { token });
  const kbId = (kbs.data?.kbs ?? [])[0]?.id;
  check("setup: kbId for chat", !!kbId);

  // ── 1. JavaScript SDK ────────────────────────────────────────────────
  console.log("\n── 1. JavaScript SDK ──");
  const jsSdk = join(ROOT, "sdk", "javascript", "kai-sdk.mjs");
  check("js sdk file exists", existsSync(jsSdk));
  // Fixed, committed exercise scripts (no interpreter input from here) -
  // all runtime config flows through the child env, never through
  // interpolated codegen.
  const SMOKE_DIR = dirname(fileURLToPath(import.meta.url));
  const sdkEnv = {
    ...process.env,
    KAI_SDK_PATH: `file://${jsSdk}`,
    KAI_BASE_URL: BASE,
    KAI_KB_ID: kbId,
    KAI_API_KEY: apiKey,
  };
  try {
    const out = execFileSync("node", [join(SMOKE_DIR, "sdk-smoke-js.mjs")], {
      encoding: "utf-8", timeout: 120_000, env: sdkEnv,
    });
    check("js sdk: full flow", out.includes("JS_OK"), out.trim().slice(-200));
  } catch (e) {
    check("js sdk: full flow", false, String(e.message || e).slice(0, 300));
  }

  // ── 2. Python SDK ────────────────────────────────────────────────────
  console.log("\n── 2. Python SDK ──");
  const pySdk = join(ROOT, "sdk", "python", "kai_sdk.py");
  check("py sdk file exists", existsSync(pySdk));
  try {
    const out = execFileSync("python3", [join(SMOKE_DIR, "sdk-smoke-py.py")], {
      encoding: "utf-8", timeout: 120_000,
      env: { ...sdkEnv, KAI_SDK_DIR: join(ROOT, "sdk", "python") },
    });
    check("py sdk: full flow", out.includes("PY_OK"), out.trim().slice(-200));
  } catch (e) {
    check("py sdk: full flow", false, String(e.message || e).slice(0, 300));
  }

  // ── 3. Go SDK ────────────────────────────────────────────────────────
  console.log("\n── 3. Go SDK ──");
  const goDir = join(ROOT, "sdk", "go");
  check("go sdk dir exists", existsSync(join(goDir, "kai.go")));
  const goCode = `package kai

import (
  "context"
  "testing"
)

func TestLiveServer(t *testing.T) {
  c := New(${JSON.stringify(apiKey)}, ${JSON.stringify(BASE)})
  ctx := context.Background()
  me, err := c.Me(ctx)
  if err != nil || me.User.ID == "" { t.Fatalf("me: %v %+v", err, me) }
  list, err := c.ListKnowledgeBases(ctx)
  if err != nil || len(list.Kbs) == 0 { t.Fatalf("list: %v", err) }
  created, err := c.CreateKnowledgeBase(ctx, "SDK Go 测试库", "", "")
  if err != nil || created == nil { t.Fatalf("create: %v", err) }
  var tokens []string
  done, err := c.Ask(ctx, ${JSON.stringify(kbId)}, "介绍一下这个知识库的内容", func(tok string) { tokens = append(tokens, tok) })
  if err != nil || done == nil || done.ConversationID == "" { t.Fatalf("ask: %v", err) }
  if len(tokens) == 0 { t.Fatalf("no tokens") }
  task, err := c.RunAgent(ctx, "一句话总结：大模型的发展")
  if err != nil || task["status"] != "done" { t.Fatalf("agent: %v %v", err, task) }
  _, err = c.ListWebhooks(ctx)
  if err != nil { t.Fatalf("wh list: %v", err) }
  wh, err := c.CreateWebhook(ctx, "https://example.com/hook", []string{"kb.ready"}, "sdk", "")
  if err != nil || wh == nil { t.Fatalf("wh create: %v", err) }
  t.Logf("GO_OK me=%s kbs=%d tokens=%d task=%v", me.User.ID, len(list.Kbs), len(tokens), task["status"])
}
`;
  // 在临时目录编译运行（go test 要求同目录文件；不向 sdk/go 源码目录写任何
  // 运行时产物——崩溃残留会破坏 go test ./... 与 git status）。
  const fs = await import("node:fs");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const tmpGoDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), "kai-sdk-live-"));
  try {
    fs.copyFileSync(join(goDir, "kai.go"), join(tmpGoDir, "kai.go"));
    fs.copyFileSync(join(goDir, "go.mod"), join(tmpGoDir, "go.mod"));
    fs.writeFileSync(join(tmpGoDir, "sdk_live_test.go"), goCode);
    const out = execFileSync("go", ["test", "-v", "-run", "TestLiveServer", "./..."], {
      cwd: tmpGoDir, encoding: "utf-8", timeout: 180_000,
    });
    check("go sdk: full flow", out.includes("GO_OK"), out.trim().slice(-400));
  } catch (e) {
    check("go sdk: full flow", false, String(e.message || e).slice(0, 400));
  } finally {
    fs.rmSync(tmpGoDir, { recursive: true, force: true });
  }

  // ── 4. 汇总 ──────────────────────────────────────────────────────────
  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅" : "❌"} sdk smoke: ${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
