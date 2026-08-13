// @ts-nocheck
// P7-2 acceptance verification: VS Code extension (代码库内 RAG 问答).
//
//   1. Manifest structure (vsce package.json: main/engines/commands).
//   2. ask.js SSE client against a live server: login -> API key (chat:read)
//      -> askOnce returns a real answer.
//   3. sync.js workspace collector (fixture dir) + syncWorkspaceToKb via the
//      v1 documents endpoint (kb:write) -> docs land in the KB and become
//      ready through the processing queue.
//
// Run: npx tsx scripts/smoke/test-vscode.ts   (requires `pnpm dev` on :3000)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EXT_DIR = path.resolve(process.cwd(), "integrations/vscode-extension");
const require = createRequire(import.meta.url);

let failures = 0;
const results: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) results.push(`✅ ${name}`);
  else { results.push(`❌ ${name} ${detail}`); failures++; }
}

async function main() {
  console.log("\n── 1. manifest 结构 ──");
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "package.json"), "utf8"));
  check("manifest: name = kai-vscode", manifest.name === "kai-vscode");
  check("manifest: main = extension.js", manifest.main === "extension.js" || manifest.main === "./extension.js", manifest.main);
  check("manifest: engines.vscode 存在", !!manifest.engines?.vscode);
  const commands = manifest.contributes?.commands?.map((c) => c.command) ?? [];
  check("manifest: 4 个命令", commands.length === 4 && commands.includes("kai.askSelection") && commands.includes("kai.askFile") && commands.includes("kai.syncWorkspace") && commands.includes("kai.configure"), JSON.stringify(commands));
  for (const f of ["extension.js", "ask.js", "sync.js", "README.md"]) {
    check(`文件存在: ${f}`, fs.existsSync(path.join(EXT_DIR, f)));
  }
  const extSrc = fs.readFileSync(path.join(EXT_DIR, "extension.js"), "utf8");
  check("extension.js 不含网络请求协议（委托 ask.js/sync.js）", !extSrc.includes("/api/v1/chat") && extSrc.includes("require(\"./ask\")"));
  // extension.js needs the vscode module at runtime - verify its shape
  // statically (can't require() it outside the VS Code host).
  check("extension.js 声明 activate/deactivate 导出", /module\.exports\s*=\s*\{\s*activate,\s*deactivate\s*\}/.test(extSrc));

  console.log("\n── 2. ask.js 对 live server 全流程 ──");
  const ask = require(path.join(EXT_DIR, "ask.js"));
  // login (password) -> api key with chat:read -> askOnce
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
  }).then((r) => r.json());
  check("owner 登录", !!login.token);
  const key = await fetch(`${BASE}/api/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `kai-token=${login.token}` },
    body: JSON.stringify({ name: "vscode-test", scopes: ["chat:read", "kb:write"] }),
  }).then((r) => r.json());
  const apiKey = key.key?.secret;
  check("创建 API key（chat:read + kb:write）", !!apiKey);

  // KB with a document so the ask returns a grounded answer
  const kb = await fetch(`${BASE}/api/knowledge-base`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `kai-token=${login.token}` },
    body: JSON.stringify({ name: "VS Code 验收库" }),
  }).then((r) => r.json());
  const kbId = kb.kb?.id;
  check("创建 KB", !!kbId);
  const docRes = await fetch(`${BASE}/api/v1/knowledge-bases/${kbId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ name: "guide.md", content: "# 部署指南\n\n使用 pnpm build 构建项目，然后用 pnpm start 启动生产服务器。端口默认为 3000。" }),
  });
  check("v1 documents 建文档 201", docRes.status === 201, String(docRes.status));
  // wait for processing
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const kbDetail = await fetch(`${BASE}/api/knowledge-base/${kbId}`, { headers: { Cookie: `kai-token=${login.token}` } }).then((r) => r.json());
    ready = (kbDetail.docs ?? []).some((d) => d.status === "ready");
  }
  check("文档处理完成（ready）", ready);

  const answer = await ask.askOnce({ endpoint: BASE, apiKey, kbId, query: "如何启动生产服务器？" });
  check("askOnce 返回非空回答", typeof answer.answer === "string" && answer.answer.length > 0, JSON.stringify(answer).slice(0, 120));
  check("askOnce 回答提及端口/构建（有内容）", /3000|pnpm/.test(answer.answer), answer.answer.slice(0, 80));

  let threw = false;
  try {
    await ask.askOnce({ endpoint: BASE, apiKey: "kai_sk_invalid00000000000000000000000000", kbId, query: "hi" });
  } catch { threw = true; }
  check("无效 API key -> 抛错", threw);

  console.log("\n── 3. sync.js 工作区收集 + 上传 ──");
  const sync = require(path.join(EXT_DIR, "sync.js"));
  // fixture workspace
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "kai-vscode-fixture-"));
  fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "README.md"), "# 示例项目\n\n这是一个演示代码库。");
  fs.writeFileSync(path.join(fixture, "src", "index.ts"), "export const VERSION = 42; // 核心常量");
  fs.writeFileSync(path.join(fixture, "src", "data.bin"), Buffer.from([0, 1, 2, 3, 255])); // binary -> skipped
  fs.writeFileSync(path.join(fixture, "node_modules", "skip.js"), "// 应被忽略");

  const files = await sync.collectFiles(fixture);
  const names = files.map((f) => f.name).sort();
  check("收集工作区文件（忽略 node_modules/二进制）", JSON.stringify(names) === JSON.stringify(["README.md", "src/index.ts"]), JSON.stringify(names));
  check("collectFiles 返回 content", files.every((f) => typeof f.content === "string" && f.content.length > 0));

  const syncResult = await sync.syncWorkspaceToKb({ endpoint: BASE, apiKey, kbId, files });
  check("syncWorkspaceToKb 导入 2 个", syncResult.imported.length === 2, JSON.stringify(syncResult));
  const reSync = await sync.syncWorkspaceToKb({ endpoint: BASE, apiKey, kbId, files });
  check("重跑同步 -> 重名跳过（幂等）", reSync.imported.length === 0 && reSync.skipped.length >= 2, JSON.stringify(reSync));

  // docs landed + processed
  let allReady = false;
  for (let i = 0; i < 40 && !allReady; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const kbDetail = await fetch(`${BASE}/api/knowledge-base/${kbId}`, { headers: { Cookie: `kai-token=${login.token}` } }).then((r) => r.json());
    const docs = (kbDetail.docs ?? []).filter((d) => d.name.includes("README") || d.name.includes("index.ts"));
    allReady = docs.length === 2 && docs.every((d) => d.status === "ready");
  }
  check("同步文档全部 ready", allReady);

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ VS Code extension acceptance: ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
