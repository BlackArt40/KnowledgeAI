// @ts-nocheck
// P2-3 acceptance verification: report enhancement.
//   #1 four export formats (md/pdf/pptx/mindmap)
//   #2 share link permissions (expiry / password / view limit)
//   #3 report revision history (snapshot / restore / diff)
//   +  collaboration comments
// Run: npx tsx scripts/smoke/test-report-enhance.ts
import { inflateRawSync } from "zlib";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  const store = await import("../../src/lib/agent/store");
  const { exportReport } = await import("../../src/lib/agent/export");
  const { diffLines, diffSummary } = await import("../../src/lib/agent/diff");

  // Build a finished task with a report + citations.
  const task = store.createTask(
    { topic: "P2-3 验收报告", outputFormat: "report", agents: ["planner", "searcher", "analyzer", "writer"], maxSteps: 5 },
    "user_test"
  );
  task.status = "done";
  task.report =
    "# P2-3 验收报告 调研报告\n\n> 数据来源：测试库 · 由多 Agent 协作完成\n\n## 一、章节A\n\n这是章节A的内容，包含引用 [1]。\n\n## 二、章节B\n\n- 要点一\n- 要点二\n\n---\n\n## 引用来源\n\n[1] **来源1** - 摘要内容 https://example.com/source1\n";
  task.citations = [
    { n: 1, title: "来源1", source: "🌐 https://example.com/source1", snippet: "摘要内容", score: 0.92 },
    { n: 2, title: "来源2", source: "📄 ArXiv: https://arxiv.org/abs/1234", snippet: "论文摘要", score: 0.8 },
  ];
  store.saveTask(task);

  // ── 1. Export: four formats (criterion #1) ───────────────────────────
  const md = exportReport(task, "md");
  check("export: md content === report", md.content === task.report);
  check("export: md filename .md", md.filename.endsWith(".md"));
  check("export: md content-type markdown", md.contentType.includes("text/markdown"));

  const pdf = exportReport(task, "pdf");
  check("export: pdf is html document", typeof pdf.content === "string" && pdf.content.includes("<html"));
  check("export: pdf contains report title", pdf.content.includes("P2-3 验收报告"));
  check("export: pdf contains cite anchor #cite-1", pdf.content.includes('#cite-1'));
  check("export: pdf contains external source link", pdf.content.includes("https://example.com/source1"));
  check("export: pdf has auto-print script", pdf.content.includes("window.print"));

  const pptx = exportReport(task, "pptx");
  check("export: pptx is Uint8Array", pptx.content instanceof Uint8Array);
  const pb = pptx.content as Uint8Array;
  check("export: pptx zip local-file-header signature (PK\\x03\\x04)", pb[0] === 0x50 && pb[1] === 0x4b && pb[2] === 0x03 && pb[3] === 0x04);
  const eocdOk = pb[pb.length - 22] === 0x50 && pb[pb.length - 21] === 0x4b && pb[pb.length - 20] === 0x05 && pb[pb.length - 19] === 0x06;
  check("export: pptx end-of-central-directory signature", eocdOk);
  // Verify required OOXML parts are present (file names are stored uncompressed).
  const pptxStr = new TextDecoder().decode(pb);
  check("export: pptx contains [Content_Types].xml entry", pptxStr.includes("[Content_Types].xml"));
  check("export: pptx contains presentation.xml entry", pptxStr.includes("ppt/presentation.xml"));
  check("export: pptx contains slide1.xml entry", pptxStr.includes("ppt/slides/slide1.xml"));
  check("export: pptx contains slideMaster entry", pptxStr.includes("slideMaster1.xml"));
  check("export: pptx contains theme entry", pptxStr.includes("theme1.xml"));
  // Decompress slide1.xml and validate OOXML content.
  const slideData = findZipEntry(pb, "ppt/slides/slide1.xml");
  check("export: pptx slide1.xml entry found", slideData !== null);
  if (slideData) {
    const slideXml = inflateRawSync(Buffer.from(slideData)).toString("utf-8");
    check("export: slide1.xml is valid OOXML (p:sld)", slideXml.includes("<p:sld"));
    check("export: slide1.xml contains title text", slideXml.includes("P2-3 验收报告"));
    check("export: slide1.xml has bullet body placeholder", slideXml.includes('type="body"'));
  }
  check("export: pptx content-type", pptx.contentType.includes("presentationml.presentation"));

  const opml = exportReport(task, "mindmap");
  check("export: mindmap is xml string", typeof opml.content === "string" && opml.content.includes("<opml"));
  check("export: mindmap has title head", opml.content.includes("<title>P2-3 验收报告"));
  check("export: mindmap contains outline nodes", opml.content.includes("<outline"));
  check("export: mindmap contains section heading", opml.content.includes("章节A"));
  check("export: mindmap filename .opml", opml.filename.endsWith(".opml"));

  // ── 2. Share link permissions (criterion #2) ─────────────────────────
  const cfg0 = store.getShareConfig(task.id);
  check("share: default disabled", cfg0.enabled === false && cfg0.views === 0);

  const hp = store.hashPassword("s3cret");
  check("share: hashPassword is sha-256 hex", /^[0-9a-f]{64}$/.test(hp));
  check("share: verifyPassword correct", store.verifyPassword("s3cret", hp) === true);
  check("share: verifyPassword wrong rejected", store.verifyPassword("wrong", hp) === false);

  // Enable protection with expiry + password + view limit.
  store.setShareConfig(task.id, { enabled: true, expiresAt: Date.now() + 86400000, passwordHash: hp, maxViews: 3 });
  const cfg1 = store.getShareConfig(task.id);
  check("share: enabled flag set", cfg1.enabled === true);
  check("share: passwordHash stored", cfg1.passwordHash === hp);
  check("share: maxViews = 3", cfg1.maxViews === 3);
  check("share: views start at 0", cfg1.views === 0);
  check("share: not expired (future expiresAt)", cfg1.expiresAt! > Date.now());

  // View counting + limit enforcement.
  check("share: view 1 allowed", store.recordShareView(task.id) === true);
  check("share: view 2 allowed", store.recordShareView(task.id) === true);
  check("share: view 3 allowed", store.recordShareView(task.id) === true);
  check("share: view 4 blocked (limit reached)", store.recordShareView(task.id) === false);
  check("share: views counted = 3", store.getShareConfig(task.id).views === 3);

  // Expiry enforcement.
  store.setShareConfig(task.id, { enabled: true, expiresAt: Date.now() - 1000 });
  const cfg2 = store.getShareConfig(task.id);
  check("share: expired (past expiresAt)", cfg2.expiresAt! < Date.now());

  // Clearing optional fields via null.
  store.setShareConfig(task.id, { enabled: true, expiresAt: null, passwordHash: null, maxViews: null });
  const cfg3 = store.getShareConfig(task.id);
  check("share: null clears expiresAt", cfg3.expiresAt === undefined);
  check("share: null clears passwordHash", cfg3.passwordHash === undefined);
  check("share: null clears maxViews", cfg3.maxViews === undefined);

  // ── 3. Report revision history (criterion #3) ───────────────────────
  // Fresh task for clean version accounting.
  const vtask = store.createTask(
    { topic: "版本追溯测试", outputFormat: "report", agents: ["writer"], maxSteps: 3 },
    "user_test"
  );
  vtask.status = "done";
  vtask.report = "v1 初始内容";
  store.saveTask(vtask);

  const v1 = store.saveVersion(vtask.id, "v1 · 初始报告");
  check("version: saveVersion returns snapshot", !!v1);
  check("version: v1 content captured", v1.content === "v1 初始内容");
  check("version: versions length = 1", store.getTask(vtask.id).versions.length === 1);

  // Edit auto-snapshots the previous content.
  store.editReport(vtask.id, "v2 编辑后内容", "Alice");
  const vt2 = store.getTask(vtask.id);
  check("version: report updated after edit", vt2.report === "v2 编辑后内容");
  check("version: auto-snapshot added (2 versions)", vt2.versions.length === 2);
  const snap = vt2.versions[vt2.versions.length - 1];
  check("version: snapshot preserves old content", snap.content === "v1 初始内容");
  check("version: snapshot author recorded", snap.author === "Alice");

  // Dedup: editing to identical content does not add a version.
  store.editReport(vtask.id, "v2 编辑后内容");
  check("version: dedup skips identical content", store.getTask(vtask.id).versions.length === 2);

  // getVersion lookup.
  const gv = store.getVersion(vtask.id, v1.id);
  check("version: getVersion by id", gv?.content === "v1 初始内容");

  // Restore: snapshots current, then sets report to target.
  const restoreOk = store.restoreVersion(vtask.id, v1.id, "Bob");
  check("version: restore succeeds", restoreOk === true);
  check("version: restore sets report back to v1", store.getTask(vtask.id).report === "v1 初始内容");
  check("version: restore adds pre-restore snapshot (3 versions)", store.getTask(vtask.id).versions.length === 3);

  // Diff algorithm.
  const d = diffLines("a\nb\nc", "a\nx\nc");
  check("diff: detects removed line b", d.some((x: any) => x.op === "remove" && x.text === "b"));
  check("diff: detects added line x", d.some((x: any) => x.op === "add" && x.text === "x"));
  check("diff: keeps equal lines a & c", d.some((x: any) => x.op === "equal" && x.text === "a") && d.some((x: any) => x.op === "equal" && x.text === "c"));
  const sum = diffSummary(d);
  check("diff: summary counts", sum.added === 1 && sum.removed === 1 && sum.unchanged === 2);

  // ── 4. Collaboration comments ───────────────────────────────────────
  const ctask = store.createTask(
    { topic: "评论测试", outputFormat: "report", agents: ["writer"], maxSteps: 3 },
    "user_test"
  );
  const c1 = store.addComment(ctask.id, { userName: "Alice", text: "这条引用很关键", citeN: 1, userId: "u1" });
  check("comment: add returns comment", !!c1);
  check("comment: anchored to citeN=1", c1.citeN === 1);
  const c2 = store.addComment(ctask.id, { userName: "Bob", text: "同意", parentId: c1.id, userId: "u2" });
  check("comment: reply sets parentId", c2.parentId === c1.id);
  const c3 = store.addComment(ctask.id, { userName: "Carol", text: "通用评论" });
  check("comment: general comment has no citeN", c3.citeN === undefined);
  check("comment: 3 comments stored", store.getTask(ctask.id).comments.length === 3);
  const delOk = store.deleteComment(ctask.id, c2.id);
  check("comment: delete succeeds", delOk === true);
  check("comment: 2 comments remain", store.getTask(ctask.id).comments.length === 2);
  const delAgain = store.deleteComment(ctask.id, c2.id);
  check("comment: delete missing returns false", delAgain === false);

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Locate a zip entry's compressed data by name and return its raw bytes. */
function findZipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const nameBuf = new TextEncoder().encode(name);
  for (let i = 0; i <= bytes.length - 30; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      const nameLen = bytes[i + 26] | (bytes[i + 27] << 8);
      const extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
      if (nameLen === nameBuf.length) {
        let match = true;
        for (let j = 0; j < nameBuf.length; j++) {
          if (bytes[i + 30 + j] !== nameBuf[j]) { match = false; break; }
        }
        if (match) {
          const compSize = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
          const dataStart = i + 30 + nameLen + extraLen;
          return bytes.subarray(dataStart, dataStart + compSize);
        }
      }
    }
  }
  return null;
}

main();
