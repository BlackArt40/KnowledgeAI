// @ts-nocheck
// P7-4 acceptance verification: multimodal support.
//   1. 图片文档可被检索: generate an image with text (canvas) -> upload ->
//      OCR/vision indexed -> a chat query about that text retrieves the image
//      document as a source
//   2. 图片+文本混合提问: POST /api/chat with base64 image attachments ->
//      the answer references the image content (demo mode: OCR context)
//   3. 字幕文件: upload a .srt -> processed as type subtitle -> its dialogue
//      text is retrievable
// Run: npx tsx scripts/smoke/test-multimodal.ts   (requires `pnpm dev`)

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

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

  /** POST /api/chat with a body, return sources + full answer. */
  async function chatSse(token, body) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sources = [];
    let answer = "";
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
          if (ev.type === "sources") sources = ev.chunks ?? [];
          if (ev.type === "token") answer += ev.text ?? "";
        } catch {}
      }
    }
    return { sources, answer };
  }

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const login = await req("POST", "/api/auth/login", {
    body: { email: "owner@knowledgeai.dev", password: "password123" },
  });
  const token = login.data?.token;
  check("login: owner token", !!token);

  // 生成一张带英文文字的图片（OCR 更可靠），同时用于「图片文档」与「混合提问」
  const canvas = createCanvas(640, 240);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 640, 240);
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 36px sans-serif";
  ctx.fillText("STAR PROTOCOL LAUNCH", 60, 90);
  ctx.font = "24px sans-serif";
  ctx.fillText("Version 2.0 released in 2026", 60, 140);
  ctx.fillText("Partners: CloudBase Inc.", 60, 180);
  const imgBuf = canvas.toBuffer("image/png");
  const imgB64 = imgBuf.toString("base64");
  writeFileSync("/tmp/kai-multimodal-test.png", imgBuf);

  const kbRes = await req("POST", "/api/v1/knowledge-bases", { token, body: { name: "多模态验收库" } });
  const kbId = kbRes.data?.kb?.id;
  check("create kb", !!kbId);

  // ── 1. 图片文档可被检索 ──────────────────────────────────────────────
  console.log("\n── 1. 图片文档检索 ──");
  const form = new FormData();
  form.append("files", new Blob([imgBuf], { type: "image/png" }), "launch-poster.png");
  const upRes = await fetch(`${BASE}/api/knowledge-base/${kbId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upData = await upRes.json();
  const imgDocId = upData.docs?.[0]?.id;
  check("upload image doc: 201", upRes.status === 201 && !!imgDocId, JSON.stringify(upData).slice(0, 150));
  check("image doc typed as image", upData.docs?.[0]?.type === "image", String(upData.docs?.[0]?.type));

  let ready = false;
  for (let i = 0; i < 60; i++) {
    const detail = await req("GET", `/api/knowledge-base/${kbId}`, { token });
    const docs = detail.data?.docs ?? [];
    if (docs.length === 1 && docs[0].status === "ready") { ready = true; break; }
    await sleep(500);
  }
  check("image doc processed (OCR)", ready, "timeout waiting for ready");

  // 查询图片中的文字 → 应该检索到该图片文档（demo 模式 OCR 文本入索引）
  const q1 = await chatSse(token, { kbId, query: "What does the STAR PROTOCOL poster say?" });
  check("chat: answer produced", q1.answer.length > 0, q1.answer.slice(0, 80));
  const imgCited = (q1.sources ?? []).some((c) => c.docId === imgDocId);
  check("image doc retrieved by its OCR text", imgCited, `sources=${q1.sources.map((c) => c.docName).join(",")}`);
  check("answer mentions the image text", /STAR PROTOCOL|star protocol/i.test(q1.answer), q1.answer.slice(0, 100));

  // ── 2. 图片 + 文本混合提问 ───────────────────────────────────────────
  console.log("\n── 2. 混合提问 ──");
  const q2 = await chatSse(token, {
    kbId,
    query: "海报里的发布时间是哪一年？",
    images: [{ mime: "image/png", data: imgB64 }],
  });
  check("mixed QA: answer produced", q2.answer.length > 0, q2.answer.slice(0, 80));
  check("mixed QA: answer references image content", /2026/.test(q2.answer), q2.answer.slice(0, 120));

  const badImg = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kbId, query: "测试", images: [{ mime: "image/png", data: "not-base64!!" }] }),
  });
  check("mixed QA: malformed image tolerated (no 500)", badImg.status === 200, `status=${badImg.status}`);

  // ── 3. 字幕文件 ──────────────────────────────────────────────────────
  console.log("\n── 3. 字幕文件 ──");
  const srt = `1
00:00:00,000 --> 00:00:03,000
欢迎观看星辰协议的发布会

2
00:00:03,500 --> 00:00:06,000
本次发布包含全新的混合检索能力

`;
  const form2 = new FormData();
  form2.append("files", new Blob([srt], { type: "text/plain" }), "launch-talk.srt");
  const up2 = await fetch(`${BASE}/api/knowledge-base/${kbId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form2,
  });
  const up2Data = await up2.json();
  check("upload srt: 201", up2.status === 201, `status=${up2.status}`);
  check("srt doc typed as subtitle", up2Data.docs?.[0]?.type === "subtitle", String(up2Data.docs?.[0]?.type));

  let srtReady = false;
  for (let i = 0; i < 60; i++) {
    const detail = await req("GET", `/api/knowledge-base/${kbId}`, { token });
    const docs = detail.data?.docs ?? [];
    if (docs.length === 2 && docs.every((d) => d.status === "ready")) { srtReady = true; break; }
    await sleep(500);
  }
  check("srt processed", srtReady, "timeout");
  const q3 = await chatSse(token, { kbId, query: "发布会提到了什么能力？" });
  const srtCited = (q3.sources ?? []).some((c) => c.docName === "launch-talk.srt");
  check("subtitle dialogue retrievable", srtCited, `sources=${q3.sources.map((c) => c.docName).join(",")}`);

  // ── 4. 汇总 ──────────────────────────────────────────────────────────
  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅" : "❌"} multimodal smoke: ${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
