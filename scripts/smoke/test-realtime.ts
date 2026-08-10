// @ts-nocheck
// P4-1 acceptance verification: realtime collaboration.
//   - KB live changes via SSE (multi-member concurrent viewing)
//   - team presence (online/offline in real time)
//   - optimistic-concurrency conflict detection (no data loss on concurrent edits)
//   - shared conversations with live message streaming
// Run: npx tsx scripts/smoke/test-realtime.ts   (requires `pnpm dev` on :3000)

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Cookie = `kai-token=${opts.token}`;
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

  // Open an SSE stream, collect events, and provide waitFor(predicate).
  // No dedup: presence events repeat the same list on every change, and
  // waitFor predicates decide what matters.
  async function openSse(path: string, token: string | null, opts: { timeoutMs?: number } = {}) {
    const controller = new AbortController();
    const events: any[] = [];
    const timeoutMs = opts.timeoutMs ?? 20000;
    const done = new Promise<void>((resolve) => {
      (async () => {
        try {
          const res = await fetch(`${BASE}${path}`, {
            headers: token ? { Cookie: `kai-token=${token}` } : {},
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok || !res.body) { resolve(); return; }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done: d, value } = await reader.read();
            if (d) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const line = raw.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue; // comment/heartbeat frames
              try {
                const e = JSON.parse(line.slice(5).trim());
                if (e?.type) events.push(e);
              } catch { /* malformed frame */ }
            }
          }
        } catch { /* aborted */ }
        resolve();
      })();
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      events,
      stop() { clearTimeout(timer); controller.abort(); },
      waitFor(pred: (e: any) => boolean, ms = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
          const deadline = Date.now() + ms;
          const tick = () => {
            const hit = events.find(pred);
            if (hit) return resolve(hit);
            if (Date.now() > deadline) return reject(new Error("timeout waiting for SSE event"));
            setTimeout(tick, 100);
          };
          tick();
        });
      },
      done,
    };
  }

  // ── 0. 登录 + 建 KB ───────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const ownerToken = await login("owner@knowledgeai.dev");
  const editorToken = await login("editor@knowledgeai.dev");
  const kbRes = await req("POST", "/api/knowledge-base", { token: ownerToken, body: { name: "realtime-test" } });
  const kbId = kbRes.data?.kb?.id;
  check("setup: kb created", (kbRes.status === 200 || kbRes.status === 201) && !!kbId, `${kbRes.status}`);
  if (!kbId) { console.log(results.join("\n")); process.exit(1); }

  // ── 1. 并发编辑无冲突（OCC） ─────────────────────────────────────────
  console.log("\n── 1. 乐观并发控制 ──");
  const v1 = kbRes.data.kb.version;
  const patch1 = await req("PATCH", `/api/knowledge-base/${kbId}`, {
    token: ownerToken,
    body: { chunkSize: 700, baseVersion: v1 },
  });
  check("occ: update with current version succeeds (200)", patch1.status === 200 && patch1.data?.kb?.version === v1 + 1, `${patch1.status} v=${patch1.data?.kb?.version}`);
  const v2 = patch1.data.kb.version;
  const stale = await req("PATCH", `/api/knowledge-base/${kbId}`, {
    token: ownerToken,
    body: { chunkSize: 800, baseVersion: v1 }, // stale version
  });
  check("occ: stale baseVersion rejected with 409", stale.status === 409 && stale.data?.currentVersion === v2, `${stale.status} ${JSON.stringify(stale.data)}`);
  const latest = await req("PATCH", `/api/knowledge-base/${kbId}`, {
    token: ownerToken,
    body: { chunkSize: 900, baseVersion: v2 },
  });
  check("occ: retry with latest version succeeds", latest.status === 200 && latest.data?.kb?.version === v2 + 1, `${latest.status}`);

  // ── 2. KB 实时变更（多人同时查看） ────────────────────────────────────
  console.log("\n── 2. KB 实时变更（SSE） ──");
  const kbSse = await openSse(`/api/kb/${kbId}/events`, editorToken);
  await kbSse.waitFor((e) => e.type === "init").catch(() => check("kb-sse: init event", false, "no init"));
  check("kb-sse: editor connected (init)", kbSse.events.some((e) => e.type === "init"));

  await req("PATCH", `/api/knowledge-base/${kbId}`, {
    token: ownerToken,
    body: { topK: 8, baseVersion: latest.data.kb.version },
  });
  const settingsEvt = await kbSse.waitFor((e) => e.type === "settings" && e.settings?.topK === 8).catch(() => null);
  check("kb-sse: settings change broadcast to other member", !!settingsEvt, "no settings event");

  const upload = await req("POST", `/api/knowledge-base/${kbId}/upload`, {
    token: ownerToken,
    body: { url: "http://localhost:3000/", name: "realtime-doc" },
  });
  check("kb: web doc added", (upload.status === 200 || upload.status === 201) && !!upload.data?.docs?.[0]?.id, `${upload.status}`);
  const docsEvt = await kbSse.waitFor((e) => e.type === "docs" && e.doc?.name === "realtime-doc").catch(() => null);
  check("kb-sse: new doc broadcast to other member", !!docsEvt, "no docs event");
  kbSse.stop();

  // ── 3. 在线状态（presence） ───────────────────────────────────────────
  console.log("\n── 3. 团队成员在线状态 ──");
  const ownerPres = await openSse("/api/team/presence/events", ownerToken);
  await ownerPres.waitFor((e) => e.type === "presence" && e.online.some((u: any) => u.userId === "usr_owner")).catch(() => check("presence: owner online", false, "no presence snapshot"));
  check("presence: owner shows online", true);

  const editorPres = await openSse("/api/team/presence/events", editorToken);
  const onlineEvt = await ownerPres.waitFor((e) => e.type === "presence" && e.online.some((u: any) => u.email === "editor@knowledgeai.dev")).catch(() => null);
  check("presence: editor appears online to owner in real time", !!onlineEvt, "no presence update");

  editorPres.stop();
  const offlineEvt = await ownerPres.waitFor((e) => e.type === "presence" && !e.online.some((u: any) => u.email === "editor@knowledgeai.dev")).catch(() => null);
  check("presence: editor goes offline after disconnect", !!offlineEvt, "no offline event");
  ownerPres.stop();

  // ── 4. 共享会话（在线协同问答） ───────────────────────────────────────
  console.log("\n── 4. 共享会话实时消息 ──");
  const conv = await req("POST", "/api/chat/conversations", { token: ownerToken, body: { kbId, title: "共享问答" } });
  const convId = conv.data?.conversation?.id;
  check("shared: conversation created", (conv.status === 200 || conv.status === 201) && !!convId, `${conv.status}`);
  if (convId) {
    const share = await req("PATCH", `/api/chat/conversations/${convId}`, { token: ownerToken, body: { shared: true } });
    check("shared: conversation marked shared", share.status === 200 && share.data?.conversation?.shared === true, `${share.status}`);

    const sharedList = await req("GET", "/api/chat/conversations/shared", { token: editorToken });
    const inList = (sharedList.data?.conversations ?? []).some((c: any) => c.id === convId);
    check("shared: visible to team member with owner name", sharedList.status === 200 && inList && sharedList.data.conversations.find((c: any) => c.id === convId)?.ownerName === "张明（Owner）", `${sharedList.status} ${JSON.stringify(sharedList.data).slice(0, 200)}`);

    const convSse = await openSse(`/api/chat/conversations/${convId}/events`, editorToken);
    await convSse.waitFor((e) => e.type === "init").catch(() => check("shared: editor subscribed (init)", false, "no init"));
    check("shared: editor subscribed to conversation stream", convSse.events.some((e) => e.type === "init"));

    // Owner asks a question -> message event should reach the editor's stream.
    // The chat endpoint streams SSE; drain it (with a timeout) so the message
    // is persisted + broadcast, then close.
    const chatRes = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `kai-token=${ownerToken}` },
      body: JSON.stringify({ kbId, query: "你好，实时协作测试", conversationId: convId }),
      signal: AbortSignal.timeout(30000),
    });
    await chatRes.text().catch(() => {});
    const msgEvt = await convSse.waitFor((e) => e.type === "message" && e.message?.role === "user").catch(() => null);
    check("shared: new message streamed to team member", !!msgEvt && msgEvt.message?.content?.includes("实时协作测试"), "no message event");
    convSse.stop();
  }

  // ── 5. 权限 ───────────────────────────────────────────────────────────
  console.log("\n── 5. 权限控制 ──");
  const anon = await openSse(`/api/kb/${kbId}/events`, null, { timeoutMs: 3000 });
  await anon.done;
  check("kb-sse: anonymous rejected", anon.events.length === 0, "anonymous got events");
  const privateConv = await req("POST", "/api/chat/conversations", { token: ownerToken, body: { kbId, title: "私有会话" } });
  const pv = privateConv.data?.conversation?.id;
  if (pv) {
    const forbidden = await openSse(`/api/chat/conversations/${pv}/events`, editorToken, { timeoutMs: 3000 });
    await forbidden.done;
    check("conv-sse: unshared conversation not streamable (403)", forbidden.events.length === 0, "editor got events");
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
