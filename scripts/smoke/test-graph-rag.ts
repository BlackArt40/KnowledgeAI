// @ts-nocheck
// P7-3 acceptance verification: knowledge graph + GraphRAG.
//   1. upload 3 crafted docs -> the graph API exposes extracted entities
//      (晨曦科技 / 蓝海集团 / 蓝海能源) and the co-occurrence relation
//   2. same query, graphRag ON vs OFF (KB setting) - GraphRAG's cited-source
//      ordering must beat the plain retrieval (precision@1/@2 comparison)
// Run: npx tsx scripts/smoke/test-graph-rag.ts   (requires `pnpm dev`)

const BASE = process.env.BASE_URL || "http://localhost:3000";
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
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };

  /** POST /api/chat, return the SSE `sources` event (chunk order + scores). */
  async function chatSources(token, kbId, query) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kbId, query }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sources = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "sources") sources = ev.chunks;
          if (ev.type === "done") return sources;
        } catch {}
      }
    }
    return sources;
  }

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const login = await req("POST", "/api/auth/login", {
    body: { email: "owner@knowledgeai.dev", password: "password123" },
  });
  const token = login.data?.token;
  check("login: owner token", !!token);

  const kbRes = await req("POST", "/api/v1/knowledge-bases", { token, body: { name: "图谱验收库" } });
  const kbId = kbRes.data?.kb?.id;
  check("create kb", !!kbId);

  const DOCS = [
    {
      // 干扰项:高频重复查询实体与「储能」词面,让纯向量/BM25 误以为它最相关
      name: "distractor.txt",
      content:
        "晨曦科技在储能领域完成了三轮融资，累计金额超过十亿元。" +
        "晨曦科技专注云计算与大数据。晨曦科技总部位于上海，储能研发团队超过两百人。",
    },
    {
      // 关系句:晨曦科技与蓝海集团同句共现,同时直接回答「合作伙伴是谁」
      name: "relation.txt",
      content:
        "晨曦科技与蓝海集团达成战略合作，联合开发下一代储能系统。双方将共建联合实验室。",
    },
    {
      // 邻居实体句:只提到蓝海集团,不含查询实体
      name: "answer.txt",
      content:
        "蓝海集团的储能业务由子公司蓝海能源负责运营，产品出口二十多个国家。蓝海能源专注储能电池与管理系统。",
    },
  ];
  const form = new FormData();
  for (const d of DOCS) {
    form.append("files", new Blob([d.content], { type: "text/plain" }), d.name);
  }
  const upRes = await fetch(`${BASE}/api/knowledge-base/${kbId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upData = await upRes.json();
  const docIds = Object.fromEntries((upData.docs ?? []).map((d) => [d.name, d.id]));
  check("upload 3 docs", upRes.status === 201 && Object.keys(docIds).length === 3, JSON.stringify(upData).slice(0, 200));

  // 等待处理完成（parse -> chunk -> vectorize -> graph extract）
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const detail = await req("GET", `/api/knowledge-base/${kbId}`, { token });
    const docs = detail.data?.docs ?? [];
    if (docs.length === 3 && docs.every((d) => d.status === "ready")) { ready = true; break; }
    await sleep(500);
  }
  check("docs processed", ready, "timeout waiting for ready");

  // ── 1. 图谱 API：实体 + 关系 ─────────────────────────────────────────
  console.log("\n── 1. 知识图谱 API ──");
  let graph = null;
  for (let i = 0; i < 30; i++) {
    const g = await req("GET", `/api/knowledge-base/${kbId}/graph`, { token });
    graph = g.data;
    if ((graph?.nodes ?? []).length >= 3) break;
    await sleep(500);
  }
  const labels = (graph?.nodes ?? []).map((n) => n.label);
  check("graph: 晨曦科技 extracted", labels.includes("晨曦科技"), labels.join(","));
  check("graph: 蓝海集团 extracted", labels.includes("蓝海集团"));
  check("graph: 蓝海能源 extracted", labels.includes("蓝海能源"));
  check("graph: entities typed", (graph?.nodes ?? []).every((n) => ["person", "organization", "concept", "event"].includes(n.type)));
  const rel = (graph?.edges ?? []).find(
    (e) => (e.source === "晨曦科技" && e.target === "蓝海集团") || (e.source === "蓝海集团" && e.target === "晨曦科技")
  );
  check("graph: 晨曦科技-蓝海集团 relation", !!rel, JSON.stringify(graph?.edges ?? []).slice(0, 200));
  check("graph: relation has weight", !!rel && rel.weight >= 1);

  // 匿名/越权
  const anon = await req("GET", `/api/knowledge-base/${kbId}/graph`);
  check("graph 匿名: 401", anon.status === 401, `status=${anon.status}`);
  const viewer = await req("POST", "/api/auth/login", { body: { email: "viewer@knowledgeai.dev", password: "password123" } });
  const viewerToken = viewer.data?.token;
  const viewerOk = await req("GET", `/api/knowledge-base/${kbId}/graph`, { token: viewerToken });
  check("graph 公开库 viewer: 200", viewerOk.status === 200, `status=${viewerOk.status}`);
  // 设为私有后 viewer 应被拒绝
  const kbAccess = await req("PATCH", "/api/team/kb-access", {
    token, body: { kbId, access: "private" },
  });
  check("set kb private", kbAccess.status === 200, `status=${kbAccess.status}`);
  const viewerDenied = await req("GET", `/api/knowledge-base/${kbId}/graph`, { token: viewerToken });
  check("graph 私有库 viewer: 403", viewerDenied.status === 403, `status=${viewerDenied.status}`);
  await req("PATCH", "/api/team/kb-access", { token, body: { kbId, access: "view" } });

  // ── 2. GraphRAG 精度对比 ─────────────────────────────────────────────
  console.log("\n── 2. GraphRAG vs 纯向量 ──");
  const QUERY = "晨曦科技在储能领域的合作伙伴是哪家公司？";

  // graphRag OFF（纯向量/BM25 基线）
  await req("PATCH", `/api/knowledge-base/${kbId}`, { token, body: { graphRag: false, baseVersion: 1 } });
  const plain = await chatSources(token, kbId, QUERY);
  const plainOrder = (plain ?? []).map((c) => c.docId);
  const plainTop1 = plainOrder[0];
  check("baseline (no graph): retrieval returns chunks", plainOrder.length >= 3, plainOrder.join(","));
  const plainDistractorFirst = plainTop1 === docIds["distractor.txt"];
  check("baseline: distractor ranks top-1 (plain retrieval fooled by term repetition)", plainDistractorFirst, `top1=${plainTop1}`);

  // graphRag ON（默认）。答案集 = 提到「蓝海集团」（正确答案实体）的文档。
  const ANSWER_DOCS = new Set([docIds["relation.txt"], docIds["answer.txt"]]);
  await req("PATCH", `/api/knowledge-base/${kbId}`, { token, body: { graphRag: true, baseVersion: 2 } });
  const grag = await chatSources(token, kbId, QUERY);
  const gragOrder = (grag ?? []).map((c) => c.docId);
  const gragTop1 = gragOrder[0];
  check("graphRag: answer source ranks top-1", ANSWER_DOCS.has(gragTop1), `top1=${gragTop1} order=${gragOrder.join(",")}`);
  const gragDistractorPos = gragOrder.indexOf(docIds["distractor.txt"]);
  check("graphRag: distractor pushed below the answer sources", gragDistractorPos < 0 || gragDistractorPos >= gragOrder.length - 1, `distractorPos=${gragDistractorPos} order=${gragOrder.join(",")}`);

  // 精度对比:precision@1 必须严格优于基线（基线 top-1 = 干扰项）
  const plainP1 = ANSWER_DOCS.has(plainTop1) ? 1 : 0;
  const gragP1 = ANSWER_DOCS.has(gragTop1) ? 1 : 0;
  check("precision@1: graphRag > plain vector", gragP1 > plainP1, `plain=${plainP1} graphRag=${gragP1}`);
  check("precision@1: graphRag perfect", gragP1 === 1, `graphRag=${gragP1}`);

  // ── 3. 汇总 ──────────────────────────────────────────────────────────
  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅" : "❌"} graph-rag smoke: ${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
