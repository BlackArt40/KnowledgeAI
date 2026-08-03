// @ts-nocheck
// End-to-end test for chunked upload API.
// Requires: dev server running on localhost:3000
// Usage: npx tsx scripts/test-chunked-upload.ts
//
// Tests: init -> upload chunks -> status -> complete (full upload)
//        init -> partial upload -> status (resume check) -> complete
//        init -> partial upload -> abort

const BASE = "http://localhost:3000";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB (matches server default)

let token: string;
let kbId: string;

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  return res;
}

async function main() {
  // 1. Login
  console.log("[test] logging in...");
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
  const loginBody = await loginRes.json();
  token = loginBody.token;
  console.log(`[test] logged in as ${loginBody.user.email}`);

  // 2. Get a KB
  const kbRes = await api("/api/knowledge-base");
  const kbs = await kbRes.json();
  if (!kbs.kbs || kbs.kbs.length === 0) throw new Error("no KBs found");
  kbId = kbs.kbs[0].id;
  console.log(`[test] using KB: ${kbs.kbs[0].name} (${kbId})`);

  // 3. Create a test file (6 MB text file, above 5MB threshold)
  const fileSize = 6 * 1024 * 1024;
  const content = "This is a test chunk for resumable upload. ".repeat(Math.ceil(fileSize / 47));
  const fileContent = content.slice(0, fileSize);
  const fileBuffer = Buffer.from(fileContent, "utf-8");
  const filename = "chunked-upload-test.txt";
  const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);
  console.log(`[test] test file: ${filename}, ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB, ${totalChunks} chunks\n`);

  let pass = 0, fail = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`  ${ok ? "✅" : "❌"} ${label}`);
    ok ? pass++ : fail++;
  };

  // ── Test 1: Full chunked upload ──────────────────────────────
  console.log("[test 1] Full chunked upload");
  {
    const initRes = await api("/api/upload/chunk/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kbId, filename, fileSize: fileBuffer.length }),
    });
    check("init returns 200", initRes.ok);
    const init = await initRes.json();
    check(`totalChunks=${init.totalChunks} (expect ${totalChunks})`, init.totalChunks === totalChunks);
    const uploadId = init.uploadId;

    // Upload all chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
      const blob = fileBuffer.subarray(start, end);
      const form = new FormData();
      form.append("chunk", new Blob([blob]), "chunk");
      form.append("index", String(i));
      const res = await api(`/api/upload/chunk/${uploadId}`, { method: "POST", body: form });
      check(`chunk ${i} uploaded`, res.ok);
    }

    // Status
    const statusRes = await api(`/api/upload/chunk/${uploadId}/status`);
    const status = await statusRes.json();
    check(`status: all ${totalChunks} chunks received`, status.receivedChunks.length === totalChunks);
    check("status: complete=true", status.complete === true);

    // Complete
    const completeRes = await api(`/api/upload/chunk/${uploadId}/complete`, { method: "POST" });
    check("complete returns 201", completeRes.status === 201);
    const { doc } = await completeRes.json();
    check(`doc created: ${doc?.name}`, !!doc?.id);

    // Verify session cleaned up
    const afterStatus = await api(`/api/upload/chunk/${uploadId}/status`);
    check("session cleaned up after complete", afterStatus.status === 404);
  }

  // ── Test 2: Resume (partial upload, then continue) ───────────
  console.log("\n[test 2] Resume after partial upload");
  {
    const initRes = await api("/api/upload/chunk/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kbId, filename: "resume-test.txt", fileSize: fileBuffer.length }),
    });
    const init = await initRes.json();
    const uploadId = init.uploadId;

    // Upload only first chunk
    const blob = fileBuffer.subarray(0, CHUNK_SIZE);
    const form = new FormData();
    form.append("chunk", new Blob([blob]), "chunk");
    form.append("index", "0");
    await api(`/api/upload/chunk/${uploadId}`, { method: "POST", body: form });

    // Check status - only 1 chunk received
    const statusRes = await api(`/api/upload/chunk/${uploadId}/status`);
    const status = await statusRes.json();
    check(`resume: 1/${totalChunks} chunks after partial`, status.receivedChunks.length === 1);
    check("resume: complete=false", status.complete === false);

    // Upload idempotent (re-upload chunk 0 - should skip)
    const form2 = new FormData();
    form2.append("chunk", new Blob([blob]), "chunk");
    form2.append("index", "0");
    const reRes = await api(`/api/upload/chunk/${uploadId}`, { method: "POST", body: form2 });
    const reBody = await reRes.json();
    check("resume: re-upload chunk 0 skipped", reBody.skipped === true);

    // Upload remaining chunks
    for (let i = 1; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
      const form = new FormData();
      form.append("chunk", new Blob([fileBuffer.subarray(start, end)]), "chunk");
      form.append("index", String(i));
      await api(`/api/upload/chunk/${uploadId}`, { method: "POST", body: form });
    }

    // Complete
    const completeRes = await api(`/api/upload/chunk/${uploadId}/complete`, { method: "POST" });
    check("resume: complete after continuing", completeRes.status === 201);
  }

  // ── Test 3: Abort ────────────────────────────────────────────
  console.log("\n[test 3] Abort upload");
  {
    const initRes = await api("/api/upload/chunk/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kbId, filename: "abort-test.txt", fileSize: fileBuffer.length }),
    });
    const init = await initRes.json();
    const uploadId = init.uploadId;

    // Upload one chunk
    const form = new FormData();
    form.append("chunk", new Blob([fileBuffer.subarray(0, CHUNK_SIZE)]), "chunk");
    form.append("index", "0");
    await api(`/api/upload/chunk/${uploadId}`, { method: "POST", body: form });

    // Abort
    const abortRes = await api(`/api/upload/chunk/${uploadId}`, { method: "DELETE" });
    check("abort returns 200", abortRes.ok);
    const abortBody = await abortRes.json();
    check("abort: aborted=true", abortBody.aborted === true);

    // Verify session deleted
    const statusRes = await api(`/api/upload/chunk/${uploadId}/status`);
    check("abort: session deleted", statusRes.status === 404);
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log(`\n[test] ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[test] ❌ Error:", err);
  process.exit(1);
});
