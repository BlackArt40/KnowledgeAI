// @ts-nocheck
// P5-3 acceptance verification: conversation experience enhancements.
//   - like/dislike feedback persists + is queryable (GET /api/chat/feedback)
//   - negative feedback down-weights the disliked answer's cited documents
//     in later retrievals (RAG feedback loop)
//   - regenerate replaces the previous answer server-side (history hygiene)
//   - archive / restore + tags via PATCH, list filtering + dashboard effect
//   - knowledge-base recommendations (?q= keyword overlap scoring)
// Run: npx tsx scripts/smoke/test-chat-enhance.ts   (requires `pnpm dev`)

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method, path, opts = {}) {
    const headers = {};
    const cookies = [];
    if (opts.token) cookies.push(`kai-token=${opts.token}`);
    if (cookies.length) headers.Cookie = cookies.join("; ");
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }

  /** POST /api/chat and read the SSE stream until `done`; returns events. */
  async function chatSse(token, body) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `kai-token=${token}` },
      body: JSON.stringify(body),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
      }
    }
    return events;
  }

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const owner = await req("POST", "/api/auth/login", { body: { email: "owner@knowledgeai.dev", password: "password123" } });
  const token = owner.data?.token;
  check("login: owner token", !!token);
  const kbs = await req("GET", "/api/knowledge-base", { token });
  // Pick a KB that actually has ready documents (kbs[0] may be a freshly
  // created empty KB from a previous run - it sorts first by updatedAt).
  const kbId = (kbs.data?.kbs ?? []).find((k) => k.stats?.ready > 0)?.id ?? kbs.data?.kbs?.[0]?.id;
  check("setup: KB id", !!kbId, `${kbId}`);

  // ── 1. 反馈持久化 + 查询 ─────────────────────────────────────────────
  console.log("\n── 1. 反馈 ──");
  const convRes = await req("POST", "/api/chat/conversations", { token, body: { kbId, title: "P53 反馈测试会话" } });
  const convId = convRes.data?.conversation?.id;
  check("setup: conversation created", !!convId, `${convRes.status}`);

  const ev1 = await chatSse(token, { kbId, query: "产品的核心功能是什么", conversationId: convId });
  const done1 = ev1.find((e) => e.type === "done");
  check("chat: first answer done event", !!done1?.messageId, JSON.stringify(done1 ?? {}));
  const msgId = done1?.messageId;
  const citations = done1?.citations ?? [];
  check("chat: answer carries citations", citations.length > 0, `${citations.length}`);

  const fbRes = await req("POST", `/api/chat/conversations/${convId}/messages/${msgId}/feedback`, {
    token,
    body: { value: "down", note: "回答不够详细" },
  });
  check("feedback: POST down + note -> 200", fbRes.status === 200, `${fbRes.status}`);
  check("feedback: response echoes feedback", fbRes.data?.message?.feedback === "down" && fbRes.data?.message?.feedbackNote === "回答不够详细", JSON.stringify(fbRes.data?.message ?? {}));

  const convGet = await req("GET", `/api/chat/conversations/${convId}`, { token });
  const savedMsg = convGet.data?.conversation?.messages?.find((m) => m.id === msgId);
  check("feedback: persisted on conversation message", savedMsg?.feedback === "down" && savedMsg?.feedbackNote === "回答不够详细", JSON.stringify(savedMsg ?? {}));

  const fbList = await req("GET", "/api/chat/feedback?limit=5", { token });
  check("feedback: queryable via GET /api/chat/feedback", (fbList.data?.feedback ?? []).some((f) => f.messageId === msgId && f.value === "down"), JSON.stringify(fbList.data?.feedback ?? []));

  const fbBad = await req("POST", `/api/chat/conversations/${convId}/messages/${msgId}/feedback`, { token, body: { value: "maybe" } });
  check("feedback: invalid value -> 400", fbBad.status === 400, `${fbBad.status}`);

  // ── 2. 负反馈降权（RAG 闭环） ─────────────────────────────────────────
  console.log("\n── 2. 负反馈降权 ──");
  // Query again in the SAME conversation: the disliked answer's cited docIds
  // must be down-weighted in the new retrieval (score × 0.4).
  const downvotedDocIds = new Set(citations.map((c) => c.docId));
  const ev2 = await chatSse(token, { kbId, query: "产品的核心功能是什么", conversationId: convId });
  const src2 = ev2.find((e) => e.type === "sources");
  const chunks2 = src2?.chunks ?? [];
  const before = (ev1.find((e) => e.type === "sources")?.chunks ?? []);
  check("chat: second answer sources present", chunks2.length > 0, `${chunks2.length}`);
  const downed = chunks2.filter((c) => downvotedDocIds.has(c.docId));
  const beforeDowned = before.filter((c) => downvotedDocIds.has(c.docId));
  if (beforeDowned.length > 0 && downed.length > 0) {
    const ratio = downed[0].score / beforeDowned[0].score;
    check("feedback: disliked doc down-weighted (score × ~0.4)", ratio < 0.9 && ratio > 0.1, `ratio=${ratio.toFixed(3)}`);
  } else if (beforeDowned.length > 0) {
    // The disliked doc was pushed out of the top-K entirely - also a valid
    // down-weighting outcome.
    check("feedback: disliked doc dropped from retrieval", true, "dropped from top-K");
  } else {
    check("feedback: disliked doc down-weighted", false, `no overlap: before=${before.map((c) => c.docId).join(",")} down=${[...downvotedDocIds].join(",")}`);
  }

  // ── 3. 再生（服务端替换旧回答） ──────────────────────────────────────
  console.log("\n── 3. 再生 ──");
  // ev2's done carries the SECOND answer's message id - that is the one a
  // regenerate replaces (the first answer stays in history).
  const done2 = ev2.find((e) => e.type === "done");
  const secondMsgId = done2?.messageId;
  const convGetBefore = await req("GET", `/api/chat/conversations/${convId}`, { token });
  const msgCountBefore = convGetBefore.data?.conversation?.messages?.length ?? 0;
  const ev3 = await chatSse(token, { kbId, query: "产品的核心功能是什么", conversationId: convId, regenerate: true, temperature: 0.7, topK: 8 });
  const done3 = ev3.find((e) => e.type === "done");
  check("regenerate: done event", !!done3?.messageId, JSON.stringify(done3 ?? {}));
  const convGetAfter = await req("GET", `/api/chat/conversations/${convId}`, { token });
  const msgsAfter = convGetAfter.data?.conversation?.messages ?? [];
  // q1,a1,q2 + new a3 = 4; the old a2 must be replaced, not appended
  check("regenerate: message count unchanged (replace, not append)", msgsAfter.length === msgCountBefore, `before=${msgCountBefore} after=${msgsAfter.length}`);
  check("regenerate: latest old answer id gone", !msgsAfter.some((m) => m.id === secondMsgId), `secondMsgId=${secondMsgId}`);
  check("regenerate: new answer present", msgsAfter.some((m) => m.id === done3?.messageId), "");
  const src3 = ev3.find((e) => e.type === "sources");
  check("regenerate: wider topK retrieves >= sources", (src3?.chunks?.length ?? 0) >= (src2?.chunks?.length ?? 0), `before=${src2?.chunks?.length} after=${src3?.chunks?.length}`);

  // ── 4. 归档 / 标签 ───────────────────────────────────────────────────
  console.log("\n── 4. 归档 / 标签 ──");
  const tagRes = await req("PATCH", `/api/chat/conversations/${convId}`, { token, body: { tags: ["重要", "产品"] } });
  check("tags: PATCH tags -> 200 + echoed", tagRes.status === 200 && (tagRes.data?.conversation?.tags ?? []).includes("重要"), JSON.stringify(tagRes.data?.conversation?.tags ?? []));
  const listRes = await req("GET", `/api/chat/conversations?kbId=${kbId}`, { token });
  const listed = listRes.data?.conversations?.find((c) => c.id === convId);
  check("tags: list returns tags", !!listed && (listed.tags ?? []).includes("产品"), JSON.stringify(listed?.tags ?? []));

  const archRes = await req("PATCH", `/api/chat/conversations/${convId}`, { token, body: { archived: true } });
  check("archive: PATCH archived -> 200", archRes.status === 200 && archRes.data?.conversation?.archived === true, `${archRes.status}`);
  const listActive = await req("GET", `/api/chat/conversations?kbId=${kbId}`, { token });
  check("archive: hidden from default list", !(listActive.data?.conversations ?? []).some((c) => c.id === convId), "");
  const listArch = await req("GET", `/api/chat/conversations?kbId=${kbId}&archived=1`, { token });
  check("archive: visible with ?archived=1", (listArch.data?.conversations ?? []).some((c) => c.id === convId), "");
  const dash = await req("GET", "/api/chat/conversations?limit=5", { token });
  check("archive: excluded from dashboard recent (no kbId list)", !(dash.data?.conversations ?? []).some((c) => c.id === convId), "");
  const restoreRes = await req("PATCH", `/api/chat/conversations/${convId}`, { token, body: { archived: false } });
  check("archive: restore -> listed again", restoreRes.status === 200 && restoreRes.data?.conversation?.archived === false, `${restoreRes.status}`);
  const listActive2 = await req("GET", `/api/chat/conversations?kbId=${kbId}`, { token });
  check("archive: back in default list after restore", (listActive2.data?.conversations ?? []).some((c) => c.id === convId), "");

  // ── 5. 知识库推荐 ────────────────────────────────────────────────────
  console.log("\n── 5. 知识库推荐 ──");
  const recKb = await req("POST", "/api/knowledge-base", { token, body: { name: "P53 推荐目标库", desc: "移动端框架与性能优化" } });
  const recKbId = recKb.data?.kb?.id;
  check("setup: recommendation target KB created", !!recKbId, `${recKb.status}`);
  if (recKbId) {
    const rec1 = await req("GET", `/api/knowledge-base/recommend?q=${encodeURIComponent("移动端性能")}&excludeKbId=${kbId}`, { token });
    check("recommend: hits target KB by desc", (rec1.data?.recommendations ?? []).some((r) => r.id === recKbId), JSON.stringify(rec1.data?.recommendations ?? []));
    const rec2 = await req("GET", `/api/knowledge-base/recommend?q=${encodeURIComponent("移动端性能")}&excludeKbId=${recKbId}`, { token });
    check("recommend: excludes the active KB", !(rec2.data?.recommendations ?? []).some((r) => r.id === recKbId), "");
    const rec3 = await req("GET", "/api/knowledge-base/recommend?q=", { token });
    check("recommend: empty q -> empty list", (rec3.data?.recommendations ?? []).length === 0, "");
  }

  // ── summary ──────────────────────────────────────────────────────────
  console.log(`\n${results.join("\n")}`);
  console.log(`\nChat enhance smoke: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
