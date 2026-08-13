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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";

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
    body: { email: "owner@knowledgeai.dev", password: "password123" },
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
  const jsScript = `
    import { KnowledgeAI } from ${JSON.stringify(`file://${jsSdk}`)};
    const kai = new KnowledgeAI({ apiKey: ${JSON.stringify(apiKey)}, baseUrl: ${JSON.stringify(BASE)} });
    const me = await kai.me();
    if (!me.user?.id) throw new Error("me failed: " + JSON.stringify(me));
    const list = await kai.listKnowledgeBases();
    if (!Array.isArray(list.kbs)) throw new Error("list failed");
    const created = await kai.createKnowledgeBase({ name: "SDK JS 测试库" });
    if (!created.kb?.id) throw new Error("create failed");
    let tokens = "";
    const done = await kai.ask(${JSON.stringify(kbId)}, "介绍一下这个知识库的内容", { onToken: (t) => (tokens += t) });
    if (!done.conversationId) throw new Error("ask failed: " + JSON.stringify(done));
    if (tokens.length < 1) throw new Error("no tokens");
    const task = await kai.runAgent("一句话总结：大模型的发展", {});
    if (!task || task.status !== "done") throw new Error("agent failed: " + JSON.stringify(task));
    const whs = await kai.listWebhooks();
    if (!Array.isArray(whs.webhooks)) throw new Error("webhooks failed");
    const wh = await kai.createWebhook({ name: "sdk", url: "https://example.com/hook", events: ["kb.ready"] });
    if (!wh.webhook?.id) throw new Error("webhook create failed");
    await kai.deleteWebhook(wh.webhook.id);
    console.log("JS_OK me=" + me.user.id + " kbs=" + list.kbs.length + " tokens=" + tokens.length + " task=" + task.status);
  `;
  try {
    const out = execFileSync("node", ["--input-type=module", "-e", jsScript], {
      encoding: "utf-8", timeout: 120_000,
    });
    check("js sdk: full flow", out.includes("JS_OK"), out.trim().slice(-200));
  } catch (e) {
    check("js sdk: full flow", false, String(e.message || e).slice(0, 300));
  }

  // ── 2. Python SDK ────────────────────────────────────────────────────
  console.log("\n── 2. Python SDK ──");
  const pySdk = join(ROOT, "sdk", "python", "kai_sdk.py");
  check("py sdk file exists", existsSync(pySdk));
  const pyScript = `
import sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, "sdk", "python"))})
from kai_sdk import KnowledgeAI
kai = KnowledgeAI(${JSON.stringify(apiKey)}, base_url=${JSON.stringify(BASE)})
me = kai.me()
assert me["user"]["id"], "me failed"
kbs = kai.list_knowledge_bases()
assert isinstance(kbs["kbs"], list), "list failed"
created = kai.create_knowledge_base("SDK Py 测试库")
assert created["kb"]["id"], "create failed"
tokens = []
done = kai.ask(${JSON.stringify(kbId)}, "介绍一下这个知识库的内容", on_token=tokens.append)
assert done["conversationId"], "ask failed"
assert len(tokens) > 0, "no tokens"
task = kai.run_agent("一句话总结：大模型的发展")
assert task and task["status"] == "done", "agent failed"
whs = kai.list_webhooks()
assert isinstance(whs["webhooks"], list), "webhooks failed"
wh = kai.create_webhook("https://example.com/hook", ["kb.ready"], name="sdk")
assert wh["webhook"]["id"], "webhook create failed"
kai.delete_webhook(wh["webhook"]["id"])
print("PY_OK me=" + me["user"]["id"] + " kbs=" + str(len(kbs["kbs"])) + " tokens=" + str(len(tokens)) + " task=" + task["status"])
`;
  try {
    const out = execFileSync("python3", ["-c", pyScript], { encoding: "utf-8", timeout: 120_000 });
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
