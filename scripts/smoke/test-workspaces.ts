// @ts-nocheck
// P4-3 acceptance verification: multi-tenant workspace isolation.
//   - KB / conversation data isolated per workspace
//   - seamless workspace switching (kai-workspace cookie)
//   - independent workspace billing & usage meters
// Run: npx tsx scripts/smoke/test-workspaces.ts   (requires `pnpm dev` on :3000)

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method: string, path: string, opts: { token?: string; ws?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    if (opts.token) cookies.push(`kai-token=${opts.token}`);
    if (opts.ws) cookies.push(`kai-workspace=${opts.ws}`);
    if (cookies.length) headers.Cookie = cookies.join("; ");
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }

  async function login(email: string): Promise<string> {
    const r = await req("POST", "/api/auth/login", { body: { email, password: "password123" } });
    if (!r.data?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const owner = await login("owner@knowledgeai.dev");
  const editor = await login("editor@knowledgeai.dev");

  // Default workspace: create KB-A
  const kbARes = await req("POST", "/api/knowledge-base", { token: owner, body: { name: "ws-default-kb-a" } });
  const kbA = kbARes.data?.kb?.id;
  check("setup: KB-A created in default workspace", (kbARes.status === 200 || kbARes.status === 201) && !!kbA, `${kbARes.status}`);
  if (!kbA) { console.log(results.join("\n")); process.exit(1); }

  // ── 1. 创建 workspace-B ───────────────────────────────────────────────
  console.log("\n── 1. 创建 workspace-B ──");
  const wsRes = await req("POST", "/api/workspaces", {
    token: owner,
    body: { name: "Workspace B", memberEmails: ["editor@knowledgeai.dev"] },
  });
  const wsB = wsRes.data?.workspace?.id;
  check("workspace: B created (owner + editor member)", (wsRes.status === 200 || wsRes.status === 201) && !!wsB, `${wsRes.status} ${JSON.stringify(wsRes.data)}`);
  if (!wsB) { console.log(results.join("\n")); process.exit(1); }

  // Owner switches to B via the kai-workspace cookie and creates KB-B
  const kbBRes = await req("POST", "/api/knowledge-base", { token: owner, ws: wsB, body: { name: "ws-b-kb-b" } });
  const kbB = kbBRes.data?.kb?.id;
  check("workspace: KB-B created inside workspace-B", (kbBRes.status === 200 || kbBRes.status === 201) && !!kbB, `${kbBRes.status}`);

  // ── 2. 数据隔离 ───────────────────────────────────────────────────────
  console.log("\n── 2. 数据隔离 ──");
  const listDefault = await req("GET", "/api/knowledge-base", { token: owner });
  const defaultNames = (listDefault.data?.kbs ?? []).map((k: any) => k.name);
  check("isolation: KB-B NOT visible in default workspace", !defaultNames.includes("ws-b-kb-b"), `names=${defaultNames.join(",")}`);
  check("isolation: KB-A visible in default workspace", defaultNames.includes("ws-default-kb-a"));

  const listB = await req("GET", "/api/knowledge-base", { token: owner, ws: wsB });
  const bNames = (listB.data?.kbs ?? []).map((k: any) => k.name);
  check("isolation: KB-A NOT visible in workspace-B", !bNames.includes("ws-default-kb-a"), `names=${bNames.join(",")}`);
  check("isolation: KB-B visible in workspace-B", bNames.includes("ws-b-kb-b"));

  const crossWs = await req("GET", `/api/knowledge-base/${kbB}`, { token: owner });
  check("isolation: cross-workspace KB access denied (403)", crossWs.status === 403, `got ${crossWs.status}`);

  // Conversation isolation: create a conversation in ws-B, must not leak to default ws
  const convB = await req("POST", "/api/chat/conversations", { token: owner, ws: wsB, body: { kbId: kbB, title: "ws-b-conv" } });
  check("isolation: conversation created in workspace-B", (convB.status === 200 || convB.status === 201) && !!convB.data?.conversation?.id);
  const convsDefault = await req("GET", "/api/chat/conversations", { token: owner });
  const convTitles = (convsDefault.data?.conversations ?? []).map((c: any) => c.title);
  check("isolation: ws-B conversation NOT in default workspace list", !convTitles.includes("ws-b-conv"), `titles=${convTitles.join(",")}`);

  // ── 3. 无缝切换 ───────────────────────────────────────────────────────
  console.log("\n── 3. 工作区切换 ──");
  const editorList = await req("GET", "/api/workspaces", { token: editor });
  check("switch: editor belongs to 2 workspaces", (editorList.data?.workspaces ?? []).length >= 2, `count=${editorList.data?.workspaces?.length}`);
  check("switch: editor's default current workspace", editorList.data?.currentWorkspace === "ws_default", `current=${editorList.data?.currentWorkspace}`);

  const editorInB = await req("GET", "/api/knowledge-base", { token: editor, ws: wsB });
  const editorBNames = (editorInB.data?.kbs ?? []).map((k: any) => k.name);
  check("switch: editor sees KB-B after switching to workspace-B", editorBNames.includes("ws-b-kb-b"), `names=${editorBNames.join(",")}`);

  const wsList = await req("GET", "/api/workspaces", { token: owner });
  const wsBNames = (wsList.data?.workspaces ?? []).map((w: any) => w.name);
  check("switch: owner sees both workspaces", wsBNames.includes("Workspace B") && wsBNames.includes("KnowledgeAI 团队"), `names=${wsBNames.join(",")}`);

  // ── 4. 独立计费与配额 ─────────────────────────────────────────────────
  console.log("\n── 4. 独立计费与配额 ──");
  const usageDefault0 = await req("GET", "/api/usage", { token: owner });
  check("usage: default workspace meters returned", usageDefault0.status === 200 && usageDefault0.data?.usage?.workspaceId === "ws_default", `${usageDefault0.status}`);
  const qaDefault0 = usageDefault0.data?.usage?.qaUsed ?? 0;

  // Ask one question in the DEFAULT workspace -> default ws usage +1 only
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `kai-token=${owner}` },
    body: JSON.stringify({ kbId: kbA, query: "多租户测试问题" }),
    signal: AbortSignal.timeout(30000),
  });
  await chatRes.text().catch(() => {});
  const usageDefault1 = await req("GET", "/api/usage", { token: owner });
  check("usage: QA counted in default workspace", (usageDefault1.data?.usage?.qaUsed ?? 0) === qaDefault0 + 1, `before=${qaDefault0} after=${usageDefault1.data?.usage?.qaUsed}`);

  const usageB = await req("GET", "/api/usage", { token: owner, ws: wsB });
  check("usage: workspace-B has independent meters", usageB.data?.usage?.workspaceId === wsB && (usageB.data?.usage?.qaUsed ?? 0) === 0, `qa=${usageB.data?.usage?.qaUsed}`);
  check("usage: workspace-B plan is free (new workspace)", usageB.data?.plan === "free", `plan=${usageB.data?.plan}`);

  const billing = await req("GET", "/api/billing", { token: owner, ws: wsB });
  check("billing: workspace-B plan + usage exposed", billing.status === 200 && billing.data?.workspace?.id === wsB && billing.data?.workspace?.plan === "free", `${billing.status} ${JSON.stringify(billing.data?.workspace)}`);

  // ── 5. 权限与回退 ─────────────────────────────────────────────────────
  console.log("\n── 5. 权限与回退 ──");
  const bogusWs = await req("GET", "/api/workspaces", { token: owner, ws: "ws_nonexistent" });
  check("fallback: unknown workspace cookie falls back to default", bogusWs.data?.currentWorkspace === "ws_default", `current=${bogusWs.data?.currentWorkspace}`);

  const anon = await req("GET", "/api/knowledge-base");
  check("fallback: anonymous uses default workspace (401 expected)", anon.status === 401, `got ${anon.status}`);

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
